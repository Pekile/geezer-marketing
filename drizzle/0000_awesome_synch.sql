CREATE TYPE "public"."channel" AS ENUM('email', 'sms', 'whatsapp', 'viber');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('sent', 'failed');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaign_sends" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"customer_id" text NOT NULL,
	"channel" "channel" NOT NULL,
	"status" "send_status" NOT NULL,
	"error_message" text,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"product_title" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_product_id_unique" UNIQUE("product_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "campaign_sends" ADD CONSTRAINT "campaign_sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
