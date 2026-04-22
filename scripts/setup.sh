#!/bin/bash
#
# Quick Setup Script for Odoo ↔ Linear Middleware
# This script guides you through setup step-by-step
#

set -e

echo "==============================================="
echo "  Odoo ↔ Linear Middleware — Setup Script"
echo "==============================================="
echo ""

# Check if .env exists
if [ -f .env ]; then
  echo "✓ .env file found"
else
  echo "⚠ .env file not found, creating from template..."
  cp .env.example .env 2>/dev/null || {
    cat > .env << 'EOF'
# Server
PORT=3000
NODE_ENV=production

# Database
DATABASE_URL=postgresql://middleware_user:middleware_password@postgres:5432/middleware_db

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=

# Linear API
LINEAR_API_KEY=
LINEAR_WEBHOOK_SECRET=
LINEAR_BOT_USER_ID=
LINEAR_TEAM_ID=

# Odoo API
ODOO_BASE_URL=
ODOO_DB=
ODOO_USERNAME=
ODOO_PASSWORD=
ODOO_BOT_USER_ID=

# Polling
ODOO_POLL_INTERVAL_MS=30000
EOF
    echo "✓ Created .env file"
  }
fi

echo ""
echo "Step 1: Enter your credentials"
echo "================================"
echo ""

read -p "Enter Linear API Key: " LINEAR_API_KEY
read -p "Enter Linear Team ID: " LINEAR_TEAM_ID
read -p "Enter Linear Bot User ID: " LINEAR_BOT_USER_ID
read -p "Enter Linear Webhook Secret (or generate your own): " LINEAR_WEBHOOK_SECRET
read -p "Enter Odoo Base URL (e.g., http://localhost:8069): " ODOO_BASE_URL
read -p "Enter Odoo Database Name: " ODOO_DB
read -p "Enter Odoo Username: " ODOO_USERNAME
read -sp "Enter Odoo Password: " ODOO_PASSWORD
echo ""
read -p "Enter Odoo Bot User ID (or your user ID for testing): " ODOO_BOT_USER_ID

# Update .env
sed -i "s|LINEAR_API_KEY=.*|LINEAR_API_KEY=$LINEAR_API_KEY|g" .env
sed -i "s|LINEAR_TEAM_ID=.*|LINEAR_TEAM_ID=$LINEAR_TEAM_ID|g" .env
sed -i "s|LINEAR_BOT_USER_ID=.*|LINEAR_BOT_USER_ID=$LINEAR_BOT_USER_ID|g" .env
sed -i "s|LINEAR_WEBHOOK_SECRET=.*|LINEAR_WEBHOOK_SECRET=$LINEAR_WEBHOOK_SECRET|g" .env
sed -i "s|ODOO_BASE_URL=.*|ODOO_BASE_URL=$ODOO_BASE_URL|g" .env
sed -i "s|ODOO_DB=.*|ODOO_DB=$ODOO_DB|g" .env
sed -i "s|ODOO_USERNAME=.*|ODOO_USERNAME=$ODOO_USERNAME|g" .env
sed -i "s|ODOO_PASSWORD=.*|ODOO_PASSWORD=$ODOO_PASSWORD|g" .env
sed -i "s|ODOO_BOT_USER_ID=.*|ODOO_BOT_USER_ID=$ODOO_BOT_USER_ID|g" .env

echo ""
echo "✓ Credentials saved to .env"
echo ""

echo "Step 2: Start Docker"
echo "===================="
echo ""

if ! command -v docker &> /dev/null; then
  echo "⚠ Docker not found. Please install Docker first."
  exit 1
fi

echo "Starting Docker services..."
docker-compose up -d

echo "Waiting for services to start..."
sleep 10

# Check if services are running
if docker-compose ps | grep -q "Up"; then
  echo "✓ Docker services started"
else
  echo "⚠ Some services failed to start. Check logs:"
  echo "  docker-compose logs"
  exit 1
fi

echo ""
echo "Step 3: Initialize Database"
echo "==========================="
echo ""

echo "Running database migrations..."
docker-compose exec -T app npx prisma migrate deploy

echo "✓ Database initialized"
echo ""

echo "Step 4: Configuration"
echo "==================="
echo ""

read -p "Enter Odoo stage ID for 'Todo' (or blank for 1): " ODOO_TODO_STAGE
ODOO_TODO_STAGE=${ODOO_TODO_STAGE:-1}

read -p "Enter Odoo stage ID for 'In Progress' (or blank for 2): " ODOO_WIP_STAGE
ODOO_WIP_STAGE=${ODOO_WIP_STAGE:-2}

read -p "Enter Odoo stage ID for 'Done' (or blank for 3): " ODOO_DONE_STAGE
ODOO_DONE_STAGE=${ODOO_DONE_STAGE:-3}

# Update status mapping
cat > src/config/status-mapping.ts << EOF
export const STATUS_MAP: Record<string, number> = {
  'Todo': $ODOO_TODO_STAGE,
  'In Progress': $ODOO_WIP_STAGE,
  'Done': $ODOO_DONE_STAGE,
};
EOF

echo "✓ Status mapping configured"
echo ""

echo "==============================================="
echo "  Setup Complete! ✓"
echo "==============================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Check health:"
echo "   curl http://localhost:3000/health"
echo ""
echo "2. Configure remaining mappings:"
echo "   - Linear state IDs in src/config/odoo-stage-mapping.ts"
echo "   - Tag mappings in src/config/tag-mapping.ts"
echo "   - User mappings in the database"
echo ""
echo "3. Set up Linear webhook:"
echo "   Linear → Settings → Webhooks → Create"
echo "   URL: http://your-public-ip:3000/webhooks/linear"
echo "   Secret: $LINEAR_WEBHOOK_SECRET"
echo ""
echo "4. Start testing:"
echo "   Create an issue in Linear or Odoo and watch it sync!"
echo ""
echo "For more help, see TESTING_GUIDE.md"
echo ""
