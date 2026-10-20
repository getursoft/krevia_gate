-- Trigram search for society lookup
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('RESIDENT', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('WEB', 'MOBILE');

-- CreateEnum
CREATE TYPE "SocietyRoleType" AS ENUM ('ADMIN');

-- CreateEnum
CREATE TYPE "OccupancyType" AS ENUM ('OWNER', 'TENANT');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(16) NOT NULL,
    "email" VARCHAR(254),
    "fullName" VARCHAR(80) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "platformRole" "PlatformRole" NOT NULL DEFAULT 'RESIDENT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "clientType" "ClientType" NOT NULL,
    "userAgent" VARCHAR(255),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Society" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "addressLine" VARCHAR(200) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "state" VARCHAR(80) NOT NULL,
    "pincode" CHAR(6) NOT NULL,
    "towers" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Society_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "tower" VARCHAR(20) NOT NULL,
    "number" VARCHAR(10) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocietyRole" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "role" "SocietyRoleType" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocietyRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "societyId" UUID NOT NULL,
    "unitId" UUID NOT NULL,
    "occupancy" "OccupancyType" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" VARCHAR(280),
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "MembershipRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Society_slug_key" ON "Society"("slug");

-- CreateIndex
CREATE INDEX "Society_name_idx" ON "Society"("name");

-- CreateIndex
CREATE INDEX "Society_city_idx" ON "Society"("city");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_societyId_tower_number_key" ON "Unit"("societyId", "tower", "number");

-- CreateIndex
CREATE INDEX "SocietyRole_societyId_idx" ON "SocietyRole"("societyId");

-- CreateIndex
CREATE UNIQUE INDEX "SocietyRole_userId_societyId_key" ON "SocietyRole"("userId", "societyId");

-- CreateIndex
CREATE INDEX "MembershipRequest_userId_idx" ON "MembershipRequest"("userId");

-- CreateIndex
CREATE INDEX "MembershipRequest_societyId_status_idx" ON "MembershipRequest"("societyId", "status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocietyRole" ADD CONSTRAINT "SocietyRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocietyRole" ADD CONSTRAINT "SocietyRole_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRequest" ADD CONSTRAINT "MembershipRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRequest" ADD CONSTRAINT "MembershipRequest_societyId_fkey" FOREIGN KEY ("societyId") REFERENCES "Society"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRequest" ADD CONSTRAINT "MembershipRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipRequest" ADD CONSTRAINT "MembershipRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one active (PENDING or APPROVED) membership request per user.
-- Guarantees duplicate protection even under concurrent submissions.
CREATE UNIQUE INDEX "MembershipRequest_one_active_per_user"
  ON "MembershipRequest" ("userId")
  WHERE "status" IN ('PENDING', 'APPROVED');

-- Case-insensitive substring search on society name and city.
CREATE INDEX "Society_name_trgm_idx" ON "Society" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Society_city_trgm_idx" ON "Society" USING GIN ("city" gin_trgm_ops);

-- Data integrity checks.
ALTER TABLE "Society" ADD CONSTRAINT "Society_pincode_check" CHECK ("pincode" ~ '^[1-9][0-9]{5}$');
ALTER TABLE "User" ADD CONSTRAINT "User_phone_e164_check" CHECK ("phone" ~ '^\+91[6-9][0-9]{9}$');
