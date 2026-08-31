import { NextResponse } from "next/server";
import { buildCreateGroupRequest, postToTally } from "@/lib/tallyProxy";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, parent, mock } = body as {
      name?: string;
      parent?: string;
      mock?: boolean;
    };

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Missing group name" },
        { status: 400 },
      );
    }

    if (mock) {
      const mockXml = `<TALLYMESSAGE><GROUP NAME="${name}"><NAME>${name}</NAME><PARENT>${parent || "Primary"}</PARENT></GROUP></TALLYMESSAGE>`;
      return NextResponse.json({
        ok: true,
        status: 200,
        text: mockXml,
        parsed: {
          TALLYMESSAGE: { GROUP: { NAME: name, PARENT: parent || "Primary" } },
        },
        request: "(mock)",
      });
    }

    const xml = buildCreateGroupRequest(name, parent || undefined);
    const res = await postToTally(xml);

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      text: res.text,
      parsed: res.parsed ?? null,
      request: xml,
    });
  } catch (err: any) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, status: null, error: message },
      { status: 502 },
    );
  }
}
