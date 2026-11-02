import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { approvalDecisionSchema } from "@autodev/shared";

import { conflict, notFound, parse } from "../http.js";
import { approvalDto } from "../serializers.js";
import type { RouteContext } from "../types.js";

const approvalParamsSchema = z.object({
  approvalId: z.string().uuid(),
});

export function registerApprovalRoutes(app: FastifyInstance, ctx: RouteContext): void {
  const { deps } = ctx;
  const { artifacts } = deps.repositories;

  app.post("/api/approvals/:approvalId/decision", async (request) => {
    const { approvalId } = parse(approvalParamsSchema, request.params, "approval id");
    const input = parse(approvalDecisionSchema, request.body, "decision body");

    const approval = await artifacts.findApproval(approvalId);
    if (!approval) throw notFound(`Approval ${approvalId}`);
    if (approval.status !== "pending") {
      throw conflict(`Approval ${approvalId} is already ${approval.status}`);
    }

    // The orchestrator writes the decision, emits the event and wakes the run.
    // The database row is the durable record; this call cannot silently no-op.
    await deps.orchestrator.decideApproval(
      approvalId,
      input.decision,
      deps.ownerIdentity,
      input.note,
    );

    const updated = await artifacts.findApproval(approvalId);
    if (!updated) throw notFound(`Approval ${approvalId}`);
    return { approval: approvalDto(updated) };
  });
}
