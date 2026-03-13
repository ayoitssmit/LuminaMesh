import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  try {
    const res = await prisma.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: 'google',
          providerAccountId: '123'
        }
      }
    });
    console.log("Success:", res);
  } catch (error) {
    console.error("Prisma Error:", error.message);
  }
}

main().finally(() => prisma.$disconnect());
