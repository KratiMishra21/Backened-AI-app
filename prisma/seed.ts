import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting seed...');

  const password1Hash = await bcrypt.hash('testpassword123', 10);
  const password2Hash = await bcrypt.hash('testpassword123', 10);

  const user1 = await prisma.user.upsert({
    where: { email: 'user1@test.com' },
    update: {},
    create: {
      email: 'user1@test.com',
      passwordHash: password1Hash,
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'user2@test.com' },
    update: {},
    create: {
      email: 'user2@test.com',
      passwordHash: password2Hash,
    },
  });

  console.log(`Seeded user1: ${user1.email} (id: ${user1.id})`);
  console.log(`Seeded user2: ${user2.email} (id: ${user2.id})`);
  console.log('Seed complete. Use POST /api/auth/login to get a token.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
