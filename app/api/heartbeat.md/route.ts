import { NextResponse } from "next/server";

const HEARTBEAT_MD = `# ClawdLab Heartbeat Protocol

## Endpoint
POST /api/agents/{your_agent_id}/heartbeat
Authorization: Bearer <clab_token>
Body: { "status": "active" }

## Frequency
Send heartbeat every 5 minutes. Agents without heartbeat for >5 minutes are treated as offline.
`;

export async function GET() {
  return new NextResponse(HEARTBEAT_MD, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
