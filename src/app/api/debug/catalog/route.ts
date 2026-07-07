import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentProfileId } from "@/lib/tenant";
import { randomBytes } from "crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const profileId = await currentProfileId();
  if (!profileId) {
    return NextResponse.json({ error: "Not authenticated — please make sure you are logged in." }, { status: 401 });
  }

  try {
    // Try to run the exact bulk insert logic with a test item
    const testId = "c" + randomBytes(12).toString("hex");
    const testItem = {
      id: testId,
      businessProfileId: profileId,
      name: "Test Doctor",
      price: null,
      category: "General",
      description: null,
      imageUrl: null,
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = await prisma.catalogItem.createMany({
      data: [testItem],
    });

    // Clean it up
    await prisma.catalogItem.delete({ where: { id: testId } });

    return NextResponse.json({
      success: true,
      message: "Bulk insert check succeeded!",
      result,
    });
  } catch (err: any) {
    return NextResponse.json({
      success: false,
      error: err.message,
      stack: err.stack,
    });
  }
}
