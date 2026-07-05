import { type JSX, useState } from 'react';
import type { Role } from '../../lib/api';
import { InviteMemberForm } from './InviteMemberForm';
import { MembersTable } from './MembersTable';
import { PendingInvitations } from './PendingInvitations';

interface Props {
  currentUserId: string;
  currentUserRole: Role;
}

/**
 * Shell component that hosts the three pieces of the Members settings page
 * inside one React root, so they can share refresh state without going
 * through DOM events or a global store. When an invitation is created or
 * revoked, we bump `reloadKey` and the children re-fetch.
 */
export function MembersPageRoot({
  currentUserId,
  currentUserRole,
}: Props): JSX.Element {
  const [reloadKey, setReloadKey] = useState(0);
  const canInvite = currentUserRole === 'owner' || currentUserRole === 'editor';

  return (
    <div className="space-y-12">
      {canInvite && (
        <section>
          <h2
            className="text-sm font-medium mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Invite a teammate
          </h2>
          <InviteMemberForm
            currentUserRole={currentUserRole}
            onSuccess={() => setReloadKey((k) => k + 1)}
          />
        </section>
      )}

      {canInvite && (
        <section>
          <h2
            className="text-sm font-medium mb-3"
            style={{ color: 'var(--text-primary)' }}
          >
            Pending invitations
          </h2>
          <PendingInvitations reloadKey={reloadKey} />
        </section>
      )}

      <section>
        <h2
          className="text-sm font-medium mb-3"
          style={{ color: 'var(--text-primary)' }}
        >
          Current members
        </h2>
        <MembersTable
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      </section>
    </div>
  );
}
