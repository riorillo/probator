import { NextResponse } from "next/server";
import { create, getList } from "@/server/projects";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const search = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json(await getList(search));
  } catch {
    return NextResponse.json({ error: "Could not load projects. Check the database configuration." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await create(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create project." }, { status: 400 });
  }
}
