# Detection runbooks

Each alert links here. First steps for every alert:

1. Was this a planned change? Check the actor, the change ticket and recent Terraform runs.
   Infrastructure changes should come from the CI deployer or Terraform, not from people.
2. Pull the actor's other activity around that time:
   ```sql
   SELECT ts, action, resource, src_ip, outcome
   FROM falcon_security.events
   WHERE actor = @actor AND ts BETWEEN TIMESTAMP_SUB(@ts, INTERVAL 2 HOUR) AND TIMESTAMP_ADD(@ts, INTERVAL 2 HOUR)
   ORDER BY ts
   ```
3. If the account looks compromised, suspend the user or disable the service account, revoke
   its sessions and keys, and escalate.

## gcp-sa-key-created
- Is the key still needed? We use Workload Identity; long-lived keys are an exception.
- Contain: `gcloud iam service-accounts keys list --iam-account <sa>`, then disable or delete the key.
- Prevent: the org policy `iam.disableServiceAccountKeyCreation`.

## gcp-privileged-role-granted
- Who received the role, and is the member inside the organization's domain?
- Contain: remove the binding, then review what the new principal did.
- Prevent: grant privileged roles only through Terraform or just-in-time access, and use the
  org policy `iam.allowedPolicyMemberDomains`.

## gcp-bucket-made-public
- Treat this as a possible data exposure. What is in the bucket, and how long was it public?
- Contain: remove `allUsers` / `allAuthenticatedUsers`; review the bucket's data-access logs for reads.
- Removing access does not end the exposure at once: Google's edge cache can keep serving public objects until their `Cache-Control` expires, one hour by default. Rotate anything sensitive that was in the bucket.
- Prevent: the org policy `storage.publicAccessPrevention`.

## gcp-audit-logging-tampered
- Critical: detection coverage may now be gone. Restore the sink or exclusion from Terraform
  (`terraform apply`) right away.
- Treat whatever the actor did immediately before and after as suspicious.

## gcp-firewall-open-to-internet
- What port is open, and on which network? Public ingress should go only through the load balancer.
- Contain: delete or narrow the rule, then check VM logs for inbound connections.
- Prevent: hierarchical firewall policies that deny 0.0.0.0/0 to admin ports.

## gcp-secret-accessed-by-human
- Is the person on call and debugging? Confirm with them directly.
- If you can't confirm it, rotate the secret and investigate the account.
