import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.findUnique({
    where: { email: "owner@example.com" },
  });
  if (!owner) throw new Error("seed first");
  const hash = await bcrypt.hash("TechPass123!", 12);
  const u = await prisma.user.upsert({
    where: { email: "phase2-tech@example.com" },
    create: {
      email: "phase2-tech@example.com",
      name: "Phase2 Tech",
      role: "TECH",
      organizationId: owner.organizationId,
      passwordHash: hash,
      active: true,
    },
    update: { passwordHash: hash, role: "TECH", active: true },
  });
  console.log("Tech ready:", u.id);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
