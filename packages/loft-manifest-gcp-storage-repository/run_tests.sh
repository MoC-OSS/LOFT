#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

export $(grep -v '^#' .env.test | xargs)

required_env_vars=("GCP_BUCKET" "GCP_API_ENDPOINT" "GCP_API_PROJECT_ID")

missing_vars=false
for var in "${required_env_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    echo "Error: Environment variable $var is not set."
    missing_vars=true
  fi
done

docker-compose -f ./docker-compose-test.yml up -d

node initTestBucket.js
# Run tests with or without coverage based on the first command line argument
if [[ "$1" == "--coverage" ]]; then
  npm test -- --coverage  # Modify this line to match your actual coverage command if needed
else
  npm test
fi

docker-compose -f ./docker-compose-test.yml down

exit 0
