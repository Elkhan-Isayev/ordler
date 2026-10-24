CREATE TABLE "api_idempotency_keys" (
	"token_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status_code" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_keys_token_id_key_pk" PRIMARY KEY("token_id","key")
);
--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_created_idx" ON "api_idempotency_keys" USING btree ("created_at");