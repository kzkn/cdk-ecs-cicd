#!/bin/sh

if [ -n "$SSM_ACTIVATION_CODE" ]; then
  amazon-ssm-agent -register -code "$SSM_ACTIVATION_CODE" -id "$SSM_ACTIVATION_ID" -region "ap-northeast-1"
  sleep "${DURATION:-3600}"
else
  exec "$@"
fi
