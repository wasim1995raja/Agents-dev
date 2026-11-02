CREATE TYPE "public"."sms_audit_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."sms_authorization_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'resubmitted');--> statement-breakpoint
CREATE TYPE "public"."sms_gender" AS ENUM('male', 'female', 'other', 'prefer_not_to_say');--> statement-breakpoint
CREATE TYPE "public"."sms_operation_type" AS ENUM('add', 'edit', 'delete');--> statement-breakpoint
CREATE TYPE "public"."sms_user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "sms_academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(40) NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_academic_years_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sms_admissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"admission_number" varchar(80) NOT NULL,
	"academic_year_id" uuid,
	"course_id" uuid,
	"admission_date" date,
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid,
	"course_id" uuid,
	"date" date NOT NULL,
	"status" varchar(40) NOT NULL,
	"recorded_by" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar(80) NOT NULL,
	"table_name" varchar(120) NOT NULL,
	"record_id" varchar(120) NOT NULL,
	"operation_type" "sms_operation_type" NOT NULL,
	"old_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"maker_user_id" varchar(120),
	"checker_user_id" varchar(120),
	"status" "sms_audit_status" NOT NULL,
	"rejection_comment" text,
	"ip_address" varchar(45),
	"activity_description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_authorization_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"record_id" varchar(120) NOT NULL,
	"old_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"new_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_authorization_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" varchar(80) NOT NULL,
	"table_name" varchar(120) NOT NULL,
	"operation_type" "sms_operation_type" NOT NULL,
	"status" "sms_authorization_status" DEFAULT 'pending_approval' NOT NULL,
	"maker_user_id" varchar(120) NOT NULL,
	"checker_user_id" varchar(120),
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_authorization_requests_transaction_id_unique" UNIQUE("transaction_id")
);
--> statement-breakpoint
CREATE TABLE "sms_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_courses_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sms_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_departments_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "sms_fees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"student_id" uuid NOT NULL,
	"academic_year_id" uuid,
	"fee_structure_code" varchar(80) NOT NULL,
	"amount" integer NOT NULL,
	"currency" varchar(8) DEFAULT 'USD' NOT NULL,
	"due_date" date,
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar(120) NOT NULL,
	"channel" varchar(40) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_responsibilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"responsibility_name" varchar(160) NOT NULL,
	"module_name" varchar(120) NOT NULL,
	"table_name" varchar(120) NOT NULL,
	"can_add" boolean DEFAULT false NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"can_view" boolean DEFAULT false NOT NULL,
	"can_delete" boolean DEFAULT false NOT NULL,
	"maker_checker_required" boolean DEFAULT false NOT NULL,
	"maker_user_id" varchar(120),
	"checker_user_id" varchar(120),
	"checker_role_id" uuid,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sms_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_roles_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "sms_students" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admission_number" varchar(80) NOT NULL,
	"first_name" varchar(120) NOT NULL,
	"middle_name" varchar(120),
	"last_name" varchar(120) NOT NULL,
	"date_of_birth" date,
	"gender" "sms_gender",
	"email" varchar(320),
	"mobile_number" varchar(40),
	"address" text,
	"department_id" uuid,
	"course_id" uuid,
	"academic_year_id" uuid,
	"admission_date" date,
	"guardian_name" varchar(160),
	"guardian_contact" varchar(40),
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_students_admission_number_unique" UNIQUE("admission_number")
);
--> statement-breakpoint
CREATE TABLE "sms_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_user_roles_user_role_uidx" UNIQUE("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "sms_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(80) NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"role_id" uuid NOT NULL,
	"department_id" uuid,
	"status" "sms_user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sms_users_username_unique" UNIQUE("username"),
	CONSTRAINT "sms_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "sms_admissions" ADD CONSTRAINT "sms_admissions_student_id_sms_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."sms_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_admissions" ADD CONSTRAINT "sms_admissions_academic_year_id_sms_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."sms_academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_admissions" ADD CONSTRAINT "sms_admissions_course_id_sms_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."sms_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_attendance" ADD CONSTRAINT "sms_attendance_student_id_sms_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."sms_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_attendance" ADD CONSTRAINT "sms_attendance_academic_year_id_sms_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."sms_academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_attendance" ADD CONSTRAINT "sms_attendance_course_id_sms_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."sms_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_authorization_details" ADD CONSTRAINT "sms_authorization_details_request_id_sms_authorization_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."sms_authorization_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_fees" ADD CONSTRAINT "sms_fees_student_id_sms_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."sms_students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_fees" ADD CONSTRAINT "sms_fees_academic_year_id_sms_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."sms_academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_responsibilities" ADD CONSTRAINT "sms_responsibilities_checker_role_id_sms_roles_id_fk" FOREIGN KEY ("checker_role_id") REFERENCES "public"."sms_roles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_students" ADD CONSTRAINT "sms_students_department_id_sms_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."sms_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_students" ADD CONSTRAINT "sms_students_course_id_sms_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."sms_courses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_students" ADD CONSTRAINT "sms_students_academic_year_id_sms_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."sms_academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_user_roles" ADD CONSTRAINT "sms_user_roles_user_id_sms_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sms_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_user_roles" ADD CONSTRAINT "sms_user_roles_role_id_sms_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sms_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_users" ADD CONSTRAINT "sms_users_role_id_sms_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."sms_roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_users" ADD CONSTRAINT "sms_users_department_id_sms_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."sms_departments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sms_academic_years_name_idx" ON "sms_academic_years" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sms_admissions_student_idx" ON "sms_admissions" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sms_attendance_student_date_idx" ON "sms_attendance" USING btree ("student_id","date");--> statement-breakpoint
CREATE INDEX "sms_audit_logs_created_idx" ON "sms_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "sms_auth_details_request_idx" ON "sms_authorization_details" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "sms_auth_requests_status_idx" ON "sms_authorization_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_auth_requests_maker_idx" ON "sms_authorization_requests" USING btree ("maker_user_id");--> statement-breakpoint
CREATE INDEX "sms_courses_code_idx" ON "sms_courses" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sms_departments_code_idx" ON "sms_departments" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sms_fees_student_idx" ON "sms_fees" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "sms_notifications_user_idx" ON "sms_notifications" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sms_responsibilities_table_idx" ON "sms_responsibilities" USING btree ("table_name");--> statement-breakpoint
CREATE INDEX "sms_responsibilities_status_idx" ON "sms_responsibilities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_roles_name_idx" ON "sms_roles" USING btree ("name");--> statement-breakpoint
CREATE INDEX "sms_students_admission_number_idx" ON "sms_students" USING btree ("admission_number");--> statement-breakpoint
CREATE INDEX "sms_students_status_idx" ON "sms_students" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_user_roles_user_idx" ON "sms_user_roles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sms_users_role_idx" ON "sms_users" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "sms_users_status_idx" ON "sms_users" USING btree ("status");