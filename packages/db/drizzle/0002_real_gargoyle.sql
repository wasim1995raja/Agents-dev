CREATE TABLE "sms_role_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role_id" uuid NOT NULL,
	"responsibility_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_role_responsibilities_role_resp_uidx" UNIQUE("role_id","responsibility_id")
);
--> statement-breakpoint
CREATE TABLE "sms_user_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"responsibility_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_user_responsibilities_user_resp_uidx" UNIQUE("user_id","responsibility_id")
);
--> statement-breakpoint
ALTER TABLE "sms_role_responsibilities" ADD CONSTRAINT "sms_role_responsibilities_role_id_sms_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sms_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_role_responsibilities" ADD CONSTRAINT "sms_role_responsibilities_responsibility_id_sms_responsibilities_id_fk" FOREIGN KEY ("responsibility_id") REFERENCES "public"."sms_responsibilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_user_responsibilities" ADD CONSTRAINT "sms_user_responsibilities_user_id_sms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sms_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_user_responsibilities" ADD CONSTRAINT "sms_user_responsibilities_responsibility_id_sms_responsibilities_id_fk" FOREIGN KEY ("responsibility_id") REFERENCES "public"."sms_responsibilities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_role_responsibilities_role_idx" ON "sms_role_responsibilities" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sms_user_responsibilities_user_idx" ON "sms_user_responsibilities" USING btree ("user_id");