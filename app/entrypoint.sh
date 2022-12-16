#!/bin/sh

if [ -n "$SSM_ACTIVATION_CODE" ]; then
  # SEE: https://github.com/iselegant/aws-bastion-fargate
  amazon-ssm-agent -register -code "$SSM_ACTIVATION_CODE" -id "$SSM_ACTIVATION_ID" -region "ap-northeast-1"
  sleep "${DURATION:-3600}"
else
  exec "$@"
fi
