const { join } = require('node:path');
const { recase } = require('@kristiandupont/recase');
const { tryParse } = require('tagged-comment-parser');

const { generateIndexFile } = require('kanel');
// const {
//   makeGenerateZodSchemas,
//   defaultGetZodSchemaMetadata,
//   defaultGetZodIdentifierMetadata,
//   defaultZodTypeMap,
// } = require('kanel-zod');
const { makeKyselyHook } = require('kanel-kysely');

const toPascalCase = recase('snake', 'pascal');
const toCamelCase = recase('snake', 'camel');

const envPath = join(process.cwd(), '.env'); // get .env file from current working directory
require('dotenv').config({ path: envPath });

const {
  DATABASE_HOST,
  DATABASE_USER,
  DATABASE_PASSWORD,
  DATABASE_NAME,
  DATABASE_PORT,
  DATABASE_CHAT_HISTORY_SCHEMA_NAME
} = process.env;

const outputPath = './src/dbTypes';

const excludedTables = new Set(['kysely_migration', 'kysely_migration_lock']); // list of tables to exclude

function shouldIncludeTable(tableName) {
  return !excludedTables.has(tableName);
}

// const generateZodSchemas = makeGenerateZodSchemas({
//   getZodSchemaMetadata: defaultGetZodSchemaMetadata,
//   getZodIdentifierMetadata: defaultGetZodIdentifierMetadata,
//   zodTypeMap: {
//     ...defaultZodTypeMap,
//     'pg_catalog.tsvector': 'z.set(z.string())',
//     'pg_catalog.bytea': {
//       name: 'z.custom<Bytea>(v => v)',
//       typeImports: [
//         { name: 'Bytea', path: 'bytea', isAbsolute: true, isDefault: false },
//       ],
//     },
//   },
//   castToSchema: true,
// });

function getCtxTypeOverride(property, checks) {
  // Example logic assuming `ctx` must be a specific type of JSON structure or constrained in some specific way
  if (checks.some((check) => check.clause.includes('some_specific_condition_for_ctx'))) {
    // If there's a specific constraint that dictates a custom type
    return {
      name: 'Record<string, unknown>',
      import: { name: 'Record', module: 'typescript' },
      isNullable: false // Explicitly setting non-nullability
    };
  }
  // Fallback to a general JSON type if no specific constraints are found
  return {
    name: 'Record<string, any>',
    import: { name: 'Record', module: 'typescript' },
    isNullable: false // Explicitly setting non-nullability
  };
}

function getContentTypeOverride() {
  return {
    name: 'Array<Type.Entity.FullContentPart>',
    typeImports: [
      {
        name: 'Type',
        path: '@moc-global/loft-definitions',
        isAbsolute: true,
        isDefault: false
      }
    ],
    isNullable: false
  };
}

/** @type {import('../src/Config').default} */
module.exports = {
  // Include every type except the excluded tables
  typeFilter: (pgType) => pgType.kind !== 'table' || shouldIncludeTable(pgType.name),

  schemas: [DATABASE_CHAT_HISTORY_SCHEMA_NAME],
  enumStyle: 'enum',
  connection: {
    host: DATABASE_HOST,
    user: DATABASE_USER,
    password: DATABASE_PASSWORD,
    database: DATABASE_NAME,
    charset: 'utf8',
    port: DATABASE_PORT
  },

  outputPath,
  resolveViews: true,
  preDeleteOutputFolder: true,

  // Add a comment about the entity that the type represents above each type.
  getMetadata: (details, generateFor) => {
    if (details.schemaName !== DATABASE_CHAT_HISTORY_SCHEMA_NAME) return;
    const { comment: strippedComment } = tryParse(details.comment);
    const isAgentNoun = ['initializer', 'mutator'].includes(generateFor);

    const relationComment = isAgentNoun
      ? `Represents the ${generateFor} for the ${details.kind} ${details.schemaName}.${details.name}`
      : `Represents the ${details.kind} ${details.schemaName}.${details.name}`;

    const suffix = isAgentNoun ? `_${generateFor}` : '';

    return {
      name: toPascalCase(details.name + suffix),
      comment: [relationComment, ...(strippedComment ? [strippedComment] : [])],
      path: join(outputPath, toPascalCase(details.name))
    };
  },

  // Add a comment that says what the type of the column/attribute is in the database.
  getPropertyMetadata: (property, _details, generateFor) => {
    const { comment: strippedComment } = tryParse(property.comment);

    // Determine if this property should have a custom type
    // console.log('property.name: ', property.name);
    // console.log('_details.name: ', _details.name);
    // console.log('property.type.fullName: ', property.type.fullName);

    const isCustomCtx =
      property.name === 'ctx' &&
      (_details.name === 'message' || _details.name === 'session') &&
      (property.expandedType === 'pg_catalog.json' || property.expandedType === 'pg_catalog.jsonb');

    const isContentField =
      property.name === 'content' &&
      _details.name === 'message' &&
      (property.expandedType === 'pg_catalog.json' || property.expandedType === 'pg_catalog.jsonb');

    // Building the comment array with all necessary information
    const comments = [
      `Database type: ${property.type.fullName}`, // Use the custom or expanded type
      ...(generateFor === 'initializer' && property.defaultValue ? [`Default value: ${property.defaultValue}`] : []),
      ...(strippedComment ? [strippedComment] : [])
    ];

    let typeOverride;
    if (isCustomCtx) {
      typeOverride = getCtxTypeOverride(property, _details.checks);
    } else if (isContentField) {
      typeOverride = getContentTypeOverride();
    }

    return {
      name: toCamelCase(property.name),
      comment: comments,
      typeOverride
      // nullableOverride: false, // Explicitly setting nullable override here
      // optionalOverride: false // Ensure the field is not optional
    };
  },

  // This implementation will generate flavored instead of branded types.
  // See: https://spin.atomicobject.com/2018/01/15/typescript-flexible-nominal-typing/
  generateIdentifierType: (c, d) => {
    // Id columns are already prefixed with the table name, so we don't need to add it here
    const name = `${toPascalCase(d.informationSchemaValue.table_name)}${toPascalCase(c.name)}`;

    return {
      declarationType: 'typeDeclaration',
      name,
      exportAs: 'named',
      typeDefinition: [`string & { __flavor?: '${name}' }`],
      comment: [`Identifier type for ${d.name}`]
    };
  },

  // Generate an index file with exports of everything
  preRenderHooks: [makeKyselyHook(), /* generateZodSchemas, */ generateIndexFile],

  customTypeMap: {
    // A text search vector could be stored as a set of strings. See Film.ts for an example.
    'pg_catalog.tsvector': 'Set<string>',

    // The bytea package (https://www.npmjs.com/package/postgres-bytea) could be used for byte arrays.
    // See Staff.ts for an example.
    'pg_catalog.bytea': {
      name: 'bytea',
      typeImports: [{ name: 'bytea', path: 'bytea', isAbsolute: true, isDefault: true }]
    },

    // Columns with the following types would probably just be strings in TypeScript.
    'pg_catalog.bpchar': 'string',
    'public.citext': 'string'
  }
};
