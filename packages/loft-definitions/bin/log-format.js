#!/usr/bin/env node
/* eslint-disable no-undef */
/* eslint-disable @typescript-eslint/no-var-requires */

const { Transform, pipeline } = require('stream');
const jsonColorize = require('json-colorizer');

// Forward important signals to the process group
['SIGINT', 'SIGTERM', 'SIGUSR2', 'SIGQUIT'].forEach((signal) => {
  process.on(signal, () => {
    process.kill(process.pid, signal);
  });
});

function pad(str, length) {
  return str.length < length ? str.padEnd(length, ' ') : str;
}

function colorize(text, colorCode) {
  // ANSI escape code for colorizing
  return `\x1b[${colorCode}m${text}\x1b[0m`;
}

function formatLog(log) {
  const { level, time, pid, source, target, msg, error, extra } = log;
  const date = new Date(time);
  const formattedTime = date.toISOString().substr(11, 12);

  // Convert log level number to text
  const levels = {
    10: { text: 'TRACE', color: '90' }, // Bright black (grey)
    20: { text: 'DEBUG', color: '34' }, // Blue
    30: { text: 'INFO', color: '32' }, // Green
    40: { text: 'WARN', color: '33' }, // Yellow
    50: { text: 'ERROR', color: '31' }, // Red
    60: { text: 'FATAL', color: '35' } // Magenta
  };
  const { text: levelText, color: levelColor } = levels[level] || {
    text: 'UNKNOWN',
    color: '0'
  }; // Default to no color

  // Align each property
  const sourceColumn = colorize(pad(`[${source || 'UNKNOWN'}]`, 8), '92'); // Bright green
  const timeColumn = colorize(pad(formattedTime, 13), '36'); // Cyan
  const levelColumn = colorize(pad(levelText, 6), levelColor);
  const pidColumn = colorize(pad(`(${pid})`, 8), '90'); // Bright black (grey)
  const targetColumn = colorize(pad(`[${target}]`, 20), '94'); // Bright blue

  let formattedError = '';
  if (error) {
    formattedError = `\n${jsonColorize(JSON.stringify(error, null, 2))
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '    ')}`;
  }

  let formattedExtra = '';
  if (extra) {
    formattedExtra = extra
      .map(
        (x) =>
          `\n${jsonColorize(JSON.stringify(x, null, 2))
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '    ')}`
      )
      .join('');
    formattedExtra = formattedExtra.replace(/^\n/, '');
  }

  return `${sourceColumn} ${timeColumn} ${pidColumn} ${levelColumn} - ${targetColumn}: ${msg}${formattedError}${formattedExtra}`;
}

let buffer = '';

const transformStream = new Transform({
  transform(chunk, encoding, callback) {
    buffer += chunk.toString();
    let position;
    while ((position = buffer.indexOf('\n')) >= 0) {
      // Assumes logs are newline-delimited
      let line = buffer.substring(0, position);
      buffer = buffer.substring(position + 1);
      try {
        const logObject = JSON.parse(line);
        const formatted = formatLog(logObject);
        this.push(formatted + '\n');
      } catch (error) {
        // If it's not JSON or incomplete JSON, handle accordingly
        // For now, just push the line for visibility
        this.push(line + '\n');
      }
    }
    callback();
  }
});

pipeline(process.stdin, transformStream, process.stdout, (err) => {
  if (err) {
    console.error('Pipeline failed.', err);
  }
});
