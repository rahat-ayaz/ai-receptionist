import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
    }
  });
  const profiles = await prisma.businessProfile.findMany({
    select: {
      id: true,
      name: true,
      userId: true,
    }
  });
  console.log("Users:", users);
  console.log("Profiles:", profiles);
}

main().catch(console.error);
