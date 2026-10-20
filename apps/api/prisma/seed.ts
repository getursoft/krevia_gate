/**
 * Development seed: sample societies (fictional) plus an optional demo society admin and security guard.
 * Idempotent. Refuses to run in production.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { normalizeIndianMobile } from '@krevia/shared';
import { loadEnvFileInto } from '../src/config';
import { hashPassword } from '../src/auth/password';

export const SAMPLE_SOCIETIES = [
  { slug: 'green-valley-residency-pune', name: 'Green Valley Residency', addressLine: 'Baner Road, Baner', city: 'Pune', state: 'Maharashtra', pincode: '411045', towers: ['T1', 'T2', 'T3'] },
  { slug: 'lakeview-heights-bengaluru', name: 'Lakeview Heights', addressLine: 'Outer Ring Road, Bellandur', city: 'Bengaluru', state: 'Karnataka', pincode: '560103', towers: ['A', 'B', 'C', 'D'] },
  { slug: 'sunrise-enclave-gurugram', name: 'Sunrise Enclave', addressLine: 'Sector 54, Golf Course Road', city: 'Gurugram', state: 'Haryana', pincode: '122011', towers: ['Tower 1', 'Tower 2'] },
  { slug: 'palm-grove-apartments-chennai', name: 'Palm Grove Apartments', addressLine: 'OMR, Thoraipakkam', city: 'Chennai', state: 'Tamil Nadu', pincode: '600097', towers: ['North', 'South'] },
  { slug: 'shanti-niketan-chs-mumbai', name: 'Shanti Niketan CHS', addressLine: 'Link Road, Malad West', city: 'Mumbai', state: 'Maharashtra', pincode: '400064', towers: ['Wing A', 'Wing B', 'Wing C'] },
  { slug: 'green-meadows-hyderabad', name: 'Green Meadows', addressLine: 'Gachibowli', city: 'Hyderabad', state: 'Telangana', pincode: '500032', towers: ['Block 1', 'Block 2', 'Block 3'] },
];

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed sample data in production.');
  }
  const envFile = join(__dirname, '..', '.env');
  if (existsSync(envFile)) loadEnvFileInto(process.env, envFile);

  const prisma = new PrismaClient();
  try {
    for (const s of SAMPLE_SOCIETIES) {
      await prisma.society.upsert({ where: { slug: s.slug }, update: { ...s }, create: { ...s } });
    }
    console.log(`Seeded ${SAMPLE_SOCIETIES.length} sample societies.`);

    const society = await prisma.society.findUniqueOrThrow({ where: { slug: SAMPLE_SOCIETIES[0].slug } });
    const staff = [
      { role: 'ADMIN' as const, name: 'Society Admin (Demo)', phone: process.env.SEED_ADMIN_PHONE, password: process.env.SEED_ADMIN_PASSWORD },
      { role: 'GUARD' as const, name: 'Security Guard (Demo)', phone: process.env.SEED_GUARD_PHONE, password: process.env.SEED_GUARD_PASSWORD },
    ];
    for (const s of staff) {
      const phone = normalizeIndianMobile(s.phone ?? '');
      if (!phone || !s.password) {
        console.log(`SEED_${s.role}_PHONE / SEED_${s.role}_PASSWORD not set — skipping demo ${s.role.toLowerCase()}.`);
        continue;
      }
      const user = await prisma.user.upsert({
        where: { phone },
        update: {},
        create: { phone, fullName: s.name, passwordHash: await hashPassword(s.password) },
      });
      await prisma.societyRole.upsert({
        where: { userId_societyId: { userId: user.id, societyId: society.id } },
        update: { role: s.role },
        create: { userId: user.id, societyId: society.id, role: s.role },
      });
      console.log(`Demo ${s.role.toLowerCase()} ${phone.slice(0, 5)}*****${phone.slice(-2)} → ${society.name}.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
