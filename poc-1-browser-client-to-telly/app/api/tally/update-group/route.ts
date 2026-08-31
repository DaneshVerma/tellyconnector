import { NextResponse } from "next/server";
import { buildUpdateGroupRequest, postToTally } from "@/lib/tallyProxy";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { oldName, newName, mock } = body as {
      oldName?: string;
      newName?: string;
      mock?: boolean;
    };

    if (!oldName || !newName) {
      return NextResponse.json(
        { ok: false, error: "Missing oldName or newName" },
        { status: 400 },
      );
    }

    if (mock) {
      const mockXml = `<TALLYMESSAGE><GROUP NAME="${oldName}"><NAME>${newName}</NAME></GROUP></TALLYMESSAGE>`;
      return NextResponse.json({
        ok: true,
        status: 200,
        text: mockXml,
        parsed: { TALLYMESSAGE: { GROUP: { NAME: newName } } },
        request: "(mock)",
      });
    }

    const xml = buildUpdateGroupRequest(oldName, newName);
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
