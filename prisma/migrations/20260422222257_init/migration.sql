-- CreateTable
CREATE TABLE "TicketMapping" (
    "id" SERIAL NOT NULL,
    "linear_id" VARCHAR(50) NOT NULL,
    "odoo_id" INTEGER NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "last_checksum" VARCHAR(64) NOT NULL,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'success',
    "sync_direction" VARCHAR(20),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" SERIAL NOT NULL,
    "event_key" VARCHAR(255) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" SERIAL NOT NULL,
    "event_type" VARCHAR(50) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "payload" JSONB,
    "status" VARCHAR(20) NOT NULL,
    "error_message" TEXT,
    "duration_ms" INTEGER,
    "correlation_id" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMapping" (
    "id" SERIAL NOT NULL,
    "linear_email" VARCHAR(255) NOT NULL,
    "odoo_email" VARCHAR(255) NOT NULL,
    "linear_user_id" VARCHAR(50),
    "odoo_user_id" INTEGER,
    "display_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentMapping" (
    "id" SERIAL NOT NULL,
    "linear_comment_id" VARCHAR(50) NOT NULL,
    "odoo_message_id" INTEGER NOT NULL,
    "ticket_mapping_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabelMapping" (
    "id" SERIAL NOT NULL,
    "linear_label_name" VARCHAR(100) NOT NULL,
    "odoo_tag_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabelMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketMapping_linear_id_key" ON "TicketMapping"("linear_id");

-- CreateIndex
CREATE UNIQUE INDEX "TicketMapping_odoo_id_key" ON "TicketMapping"("odoo_id");

-- CreateIndex
CREATE INDEX "idx_ticket_mapping_linear_odoo" ON "TicketMapping"("linear_id", "odoo_id");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_event_key_key" ON "IdempotencyKey"("event_key");

-- CreateIndex
CREATE UNIQUE INDEX "UserMapping_linear_email_key" ON "UserMapping"("linear_email");

-- CreateIndex
CREATE UNIQUE INDEX "UserMapping_odoo_email_key" ON "UserMapping"("odoo_email");

-- CreateIndex
CREATE INDEX "idx_user_mapping_linear_email" ON "UserMapping"("linear_email");

-- CreateIndex
CREATE INDEX "idx_user_mapping_odoo_email" ON "UserMapping"("odoo_email");

-- CreateIndex
CREATE UNIQUE INDEX "CommentMapping_linear_comment_id_key" ON "CommentMapping"("linear_comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "CommentMapping_odoo_message_id_key" ON "CommentMapping"("odoo_message_id");

-- CreateIndex
CREATE INDEX "idx_comment_mapping_ticket" ON "CommentMapping"("ticket_mapping_id");

-- CreateIndex
CREATE INDEX "idx_label_mapping_name" ON "LabelMapping"("linear_label_name");

-- CreateIndex
CREATE UNIQUE INDEX "LabelMapping_linear_label_name_odoo_tag_id_key" ON "LabelMapping"("linear_label_name", "odoo_tag_id");
