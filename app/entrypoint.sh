#!/bin/sh

if [ -n "$SSM_SERVICE_ROLE" ]; then
  # SEE: https://github.com/iselegant/aws-bastion-fargate
  echo "Create SSM activation"
  activation_parameters=$(aws ssm create-activation \
                              --default-instance-name bastion \
                              --description "Activation Code for Fargate Bastion" \
                              --iam-role "$SSM_SERVICE_ROLE" \
                              --region "ap-northeast-1")

  export activation_code=`echo $activation_parameters | jq -r .ActivationCode`
  export activation_id=`echo $activation_parameters | jq -r .ActivationId`

  echo "Activate SSM Agent on Fargate Task"
  amazon-ssm-agent -register -code "${activation_code}" -id "${activation_id}" -region 'ap-northeast-1'

  echo "Delete Activation Code"
  aws ssm delete-activation --activation-id ${activation_id}
fi

exec "$@"
