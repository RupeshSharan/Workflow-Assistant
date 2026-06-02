import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { api } from "../api";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Session } from "../types";

interface NotificationCenterProps {
  session: Session;
}

export function NotificationCenter({ session }: NotificationCenterProps) {
  const queryClient = useQueryClient();

  const notifications = useQuery({
    queryKey: ["notifications", session.activeWorkspaceId],
    queryFn: () => api.notifications(session)
  });

  const readMutation = useMutation({
    mutationFn: (notificationId: string) => api.readNotification(session, notificationId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications", session.activeWorkspaceId] })
  });

  return (
    <section className="notifications-page">
      <div className="page-intro">
        <p className="eyebrow">Notification center</p>
        <h3>Updates from this workspace.</h3>
        <p>Automation notifications stay within your selected tenant and workspace.</p>
      </div>

      {notifications.isLoading ? (
        <LoadingSpinner message="Loading notifications..." />
      ) : (
        <div className="notification-list">
          {notifications.data?.notifications.map((notification) => (
            <article key={notification.id} className={notification.readAt ? "" : "unread"}>
              <Bell size={17} />
              <div>
                <strong>{notification.title}</strong>
                <p>{notification.body}</p>
                <small>{new Date(notification.createdAt).toLocaleString()}</small>
              </div>
              {!notification.readAt && (
                <button className="secondary" onClick={() => readMutation.mutate(notification.id)}>
                  Mark read
                </button>
              )}
            </article>
          ))}
          {!notifications.data?.notifications.length && (
            <p className="muted-message">No notifications in this workspace.</p>
          )}
        </div>
      )}
    </section>
  );
}
