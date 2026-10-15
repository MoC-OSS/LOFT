#!/bin/bash

set -e  # Exit immediately if a command exits with a non-zero status.

export $(grep -v '^#' .env.test | xargs)

required_env_vars=("S3_REGION" "S3_BUCKET_NAME" "S3_ENDPOINT")

missing_vars=false
for var in "${required_env_vars[@]}"; do
  if [[ -z "${!var}" ]]; then
    echo "Error: Environment variable $var is not set."
    missing_vars=true
  fi
done

# Check if awslocal is installed
if ! command -v awslocal &> /dev/null
then
    echo "Error: awslocal is not installed. Please install awslocal before running this script."
    exit 1
fi

docker-compose -f ./docker-compose-test.yml up -d

awslocal s3api create-bucket --bucket $S3_BUCKET_NAME

# Run tests with or without coverage based on the first command line argument
if [[ "$1" == "--coverage" ]]; then
  npm test -- --coverage  # Modify this line to match your actual coverage command if needed
else
  npm test
fi

docker-compose -f ./docker-compose-test.yml down

exit 0
