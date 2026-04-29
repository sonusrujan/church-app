#!/usr/bin/env bash
set -euo pipefail

# ── SHALOM Church App — AWS Deployment Script ──
# Prerequisites: AWS CLI configured, Docker installed

APP_NAME="${APP_NAME:-shalom}"
REGION="${AWS_REGION:-ap-south-1}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${APP_NAME}-backend"
STACK_NAME="${APP_NAME}-stack"

echo "╔══════════════════════════════════════╗"
echo "║   SHALOM AWS Deployment              ║"
echo "║   Account: ${ACCOUNT_ID}             ║"
echo "║   Region:  ${REGION}                 ║"
echo "╚══════════════════════════════════════╝"

# ── Step 1: Validate parameters ──
if [[ -z "${DB_PASSWORD:-}" ]]; then
  echo "❌ DB_PASSWORD env var is required (min 12 chars)"
  exit 1
fi
if [[ -z "${JWT_SECRET:-}" ]]; then
  echo "❌ JWT_SECRET env var is required (min 32 chars)"
  exit 1
fi
# Warn about secrets that should be pre-stored in SSM before deploying
for SECRET_KEY in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET \
                  TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VERIFY_SERVICE_SID \
                  VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY SENTRY_DSN; do
  if ! aws ssm get-parameter --name "/${APP_NAME}/${SECRET_KEY}" --region "$REGION" &>/dev/null; then
    echo "⚠️  WARNING: SSM parameter /${APP_NAME}/${SECRET_KEY} is not set — ECS task will fail to start"
  fi
done

# ── Step 2: Deploy CloudFormation stack ──
echo ""
echo "📦 Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file aws/cloudformation.yaml \
  --stack-name "$STACK_NAME" \
  --parameter-overrides \
    AppName="$APP_NAME" \
    Environment=production \
    DBPassword="$DB_PASSWORD" \
    JwtSecret="$JWT_SECRET" \
  --capabilities CAPABILITY_IAM \
  --region "$REGION" \
  --no-fail-on-empty-changeset

# ── Step 3: Get outputs ──
echo ""
echo "📋 Fetching stack outputs..."
RDS_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='RDSEndpoint'].OutputValue" \
  --output text --region "$REGION")

ALB_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='ALBURL'].OutputValue" \
  --output text --region "$REGION")

CF_URL=$(aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontURL'].OutputValue" \
  --output text --region "$REGION")

DATABASE_URL="postgresql://shalom_admin:${DB_PASSWORD}@${RDS_ENDPOINT}:5432/shalom"

# ── Step 4: Store secrets in SSM Parameter Store ──
echo ""
echo "🔐 Storing secrets in SSM Parameter Store..."
aws ssm put-parameter \
  --name "/${APP_NAME}/DATABASE_URL" \
  --value "$DATABASE_URL" \
  --type SecureString \
  --overwrite \
  --region "$REGION"

aws ssm put-parameter \
  --name "/${APP_NAME}/JWT_SECRET" \
  --value "$JWT_SECRET" \
  --type SecureString \
  --overwrite \
  --region "$REGION"

# Store additional secrets if provided as env vars (otherwise must be pre-loaded manually)
for SECRET_KEY in RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET \
                  TWILIO_ACCOUNT_SID TWILIO_AUTH_TOKEN TWILIO_VERIFY_SERVICE_SID \
                  TWILIO_MESSAGING_SERVICE_SID VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY SENTRY_DSN; do
  SECRET_VAL="${!SECRET_KEY:-}"
  if [[ -n "$SECRET_VAL" ]]; then
    aws ssm put-parameter \
      --name "/${APP_NAME}/${SECRET_KEY}" \
      --value "$SECRET_VAL" \
      --type SecureString \
      --overwrite \
      --region "$REGION"
    echo "   ✅ Stored ${SECRET_KEY}"
  fi
done

# ── Step 5: Run database migration ──
echo ""
echo "🗄️  Running database migration..."
echo "   (Ensure your IP has access or use a bastion host)"
echo "   Run manually:"
echo "   psql \"$DATABASE_URL\" -f db/aws_rds_full_schema.sql"

# ── Step 6: Build and push Docker image ──
echo ""
IMAGE_TAG=$(git rev-parse --short HEAD 2>/dev/null || echo "latest")
echo "🐳 Building Docker image (tag: ${IMAGE_TAG})..."

# Save previous image tag for rollback
PREV_IMAGE_TAG=$(aws ecs describe-services \
  --cluster "${APP_NAME}-cluster" \
  --services "${APP_NAME}-service" \
  --query "services[0].taskDefinition" \
  --output text --region "$REGION" 2>/dev/null || echo "")

docker build -t "${APP_NAME}-backend:${IMAGE_TAG}" .

echo ""
echo "📤 Pushing to ECR..."
aws ecr get-login-password --region "$REGION" | \
  docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker tag "${APP_NAME}-backend:${IMAGE_TAG}" "${ECR_URI}:${IMAGE_TAG}"
docker tag "${APP_NAME}-backend:${IMAGE_TAG}" "${ECR_URI}:latest"
docker push "${ECR_URI}:${IMAGE_TAG}"
docker push "${ECR_URI}:latest"

# ── Step 7: Update ECS service ──
echo ""
echo "🔄 Updating ECS service..."
aws ecs update-service \
  --cluster "${APP_NAME}-cluster" \
  --service "${APP_NAME}-service" \
  --force-new-deployment \
  --region "$REGION"

# ── Step 8: Build and deploy frontend to S3 ──
echo ""
echo "🏗️  Building frontend..."
FRONTEND_BUCKET="${APP_NAME}-frontend-${ACCOUNT_ID}"

cd frontend
VITE_API_URL="${VITE_API_URL:-https://api.shalomapp.in}" npm run build
aws s3 sync dist/ "s3://${FRONTEND_BUCKET}/" --delete
cd ..

# ── Step 9: Invalidate CloudFront cache ──
CF_DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[?DomainName=='${FRONTEND_BUCKET}.s3.${REGION}.amazonaws.com']].Id" \
  --output text --region "$REGION")

if [[ -n "$CF_DIST_ID" ]]; then
  echo "🔄 Invalidating CloudFront cache..."
  aws cloudfront create-invalidation \
    --distribution-id "$CF_DIST_ID" \
    --paths "/*"
fi

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   ✅ Deployment Complete!                ║"
echo "╠══════════════════════════════════════════╣"
echo "║   Frontend: ${CF_URL}"
echo "║   Backend:  ${ALB_URL}"
echo "║   Database: ${RDS_ENDPOINT}"
echo "╚══════════════════════════════════════════╝"

if [[ -n "$PREV_IMAGE_TAG" ]]; then
  echo ""
  echo "📋 Rollback info saved. To rollback backend:"
  echo "   aws ecs update-service --cluster ${APP_NAME}-cluster --service ${APP_NAME}-service --task-definition ${PREV_IMAGE_TAG} --region ${REGION}"
fi
