#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

export $(grep -v '^#' .env.test | xargs)

required_env_vars=("POSTGRES_CONTAINER_NAME" "DATABASE_SESSION_SCHEMA_NAME" "DATABASE_POSTGRES_IMAGE" "DATABASE_USER" "DATABASE_PASSWORD" "DATABASE_NAME" "DATABASE_PORT")

missing_vars=false
for var in "${required_env_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    echo "Error: Environment variable $var is not set."
    missing_vars=true
  fi
done

docker-compose -f ./docker-compose-test.yml up -d

sleep 1

npm run build-bin
./lib/bin/migrator.js to-latest --env .env.test  

# Run tests with or without coverage based on the first command line argument
if [[ "$1" == "--coverage" ]]; then
  npm test -- --coverage  # Modify this line to match your actual coverage command if needed
else
  npm test
fi

docker-compose -f ./docker-compose-test.yml down

exit 0
