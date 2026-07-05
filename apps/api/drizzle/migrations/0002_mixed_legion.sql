-- Add Razorpay billing columns to workspaces
ALTER TABLE "workspaces"
  ADD COLUMN IF NOT EXISTS "razorpay_customer_id" text,
  ADD COLUMN IF NOT EXISTS "razorpay_subscription_id" text,
  ADD COLUMN IF NOT EXISTS "subscription_status" text,
  ADD COLUMN IF NOT EXISTS "subscription_current_period_end" timestamp with time zone;

-- Postgres has no ADD CONSTRAINT IF NOT EXISTS — use the idempotent duplicate_object guard.
DO $$ BEGIN
  ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_razorpay_customer_id_unique" UNIQUE ("razorpay_customer_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "workspaces"
    ADD CONSTRAINT "workspaces_razorpay_subscription_id_unique" UNIQUE ("razorpay_subscription_id");
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- STRIPE: ENABLE WHEN APPROVED
-- ALTER TABLE "workspaces"
--   ADD COLUMN IF NOT EXISTS "stripe_customer_id" text,
--   ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
-- ALTER TABLE "workspaces"
--   ADD CONSTRAINT IF NOT EXISTS "workspaces_stripe_customer_id_unique" UNIQUE ("stripe_customer_id");
-- ALTER TABLE "workspaces"
--   ADD CONSTRAINT IF NOT EXISTS "workspaces_stripe_subscription_id_unique" UNIQUE ("stripe_subscription_id");

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "razorpay_subscription_id" text NOT NULL,
  "razorpay_customer_id" text,
  "status" text NOT NULL,
  "plan_id" text NOT NULL,
  "plan_key" text NOT NULL,
  "quantity" integer DEFAULT 1 NOT NULL,
  "current_period_start" timestamp with time zone,
  "current_period_end" timestamp with time zone,
  "cancel_at_period_end" boolean DEFAULT false NOT NULL,
  "canceled_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscriptions_razorpay_subscription_id_unique" UNIQUE("razorpay_subscription_id")
);
-- STRIPE: ENABLE WHEN APPROVED
-- "stripe_subscription_id" text NOT NULL,
-- "stripe_customer_id" text NOT NULL,
-- "price_id" text NOT NULL,
-- "product_id" text NOT NULL,
-- CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")

--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_workspace_id_workspaces_id_fk"
    FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_workspace_idx" ON "subscriptions" USING btree ("workspace_id");

--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;
CREATE POLICY subscriptions_tenant_isolation ON "subscriptions"
  USING (workspace_id::text = current_setting('app.tenant_id', true));

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "razorpay_plan_ids" (
  "plan_key" text NOT NULL,
  "environment" text NOT NULL,
  "razorpay_plan_id" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "razorpay_plan_ids_plan_key_environment_pk" PRIMARY KEY("plan_key","environment")
);
-- STRIPE: ENABLE WHEN APPROVED
-- CREATE TABLE IF NOT EXISTS "stripe_product_ids" (
--   "plan_key" text NOT NULL,
--   "environment" text NOT NULL,
--   "product_id" text NOT NULL,
--   "price_id" text NOT NULL,
--   "created_at" timestamp with time zone DEFAULT now() NOT NULL,
--   CONSTRAINT "stripe_product_ids_plan_key_environment_pk" PRIMARY KEY("plan_key","environment")
-- );

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "webhook_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "processed_at" timestamp with time zone,
  "error" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "webhook_events_event_id_unique" UNIQUE("event_id")
  -- STRIPE: ENABLE WHEN APPROVED
  -- CONSTRAINT "webhook_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_events_type_idx" ON "webhook_events" USING btree ("event_type","created_at");
