import { NextResponse } from "next/server";
import { buildExportGroupsRequest, postToTally } from "@/lib/tallyProxy";

export async function GET(request: Request) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";

  try {
    if (mock) {
      const mockXml = `<TALLYMESSAGE><GROUP NAME="Test Group"><NAME>Test Group</NAME></GROUP></TALLYMESSAGE>`;
      return NextResponse.json({
        ok: true,
        status: 200,
        text: mockXml,
        parsed: { TALLYMESSAGE: { GROUP: { NAME: "Test Group" } } },
        request: "(mock)",
      });
    }

    const xml = buildExportGroupsRequest();
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
