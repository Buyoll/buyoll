// Buyoll Push Notification & Visual Alert System
import { GroupNotification, User, ChamaGroup } from '../types.ts';

const NOTIFICATIONS_STORAGE_KEY = 'buyoll_in_app_notifications';

export interface InAppNotification {
  id: string;
  title: string;
  body: string;
  url?: string;
  groupId?: number;
  type: 'payment_due' | 'group_invite' | 'new_group_created' | 'invite_approved' | 'invite_declined' | 'system';
  timestamp: number;
  isRead: boolean;
}

// Register service worker
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }

  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registration;
  } catch (error) {
    console.warn('Service Worker registration skipped or failed:', error);
    return null;
  }
}

// Check notification permission status
export function getNotificationPermission(): NotificationPermission {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

// Request permission from the user
export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return false;
  }

  try {
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      await registerServiceWorker();
      return true;
    }
    return false;
  } catch (err) {
    console.error('Failed to request notification permission:', err);
    return false;
  }
}

// Trigger a visual push alert (via service worker, even when app is minimized)
export async function triggerVisualPushAlert(payload: {
  title: string;
  body: string;
  url?: string;
  groupId?: number;
  tag?: string;
  type?: 'payment_due' | 'group_invite' | 'new_group_created' | 'system';
}): Promise<void> {
  const { title, body, url = '/', groupId, tag, type = 'system' } = payload;

  // 1. Save to in-app notification center
  addInAppNotification({
    id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    title,
    body,
    url,
    groupId,
    type,
    timestamp: Date.now(),
    isRead: false,
  });

  // 2. Trigger native visual push notification if permitted
  if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.active) {
        // Send command to active service worker to display notification
        reg.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          options: {
            body,
            icon: '/buyoll_logo.png',
            badge: '/buyoll_logo.png',
            tag: tag || `buyoll-${Date.now()}`,
            vibrate: [200, 100, 200],
            data: { url, groupId, type },
            requireInteraction: true,
          },
        });
      } else {
        // Fallback to standard Notification API
        new Notification(title, {
          body,
          icon: '/buyoll_logo.png',
          badge: '/buyoll_logo.png',
          tag: tag || `buyoll-${Date.now()}`,
          data: { url, groupId, type },
        });
      }
    } catch (err) {
      console.warn('Native push notification display failed:', err);
    }
  }
}

// Persistent In-App Notification Store helpers
export function getInAppNotifications(): InAppNotification[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function addInAppNotification(notif: InAppNotification) {
  if (typeof window === 'undefined') return;
  try {
    const list = getInAppNotifications();
    list.unshift(notif);
    // Keep last 30 notifications
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
    // Dispatch custom event for reactive badge count
    window.dispatchEvent(new CustomEvent('buyoll_notifications_updated'));
  } catch (e) {
    console.error('Failed to store notification:', e);
  }
}

export function markAllNotificationsAsRead() {
  if (typeof window === 'undefined') return;
  try {
    const list = getInAppNotifications().map((n) => ({ ...n, isRead: true }));
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent('buyoll_notifications_updated'));
  } catch (e) {
    console.error('Failed to mark notifications read:', e);
  }
}

export function clearInAppNotifications() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('buyoll_notifications_updated'));
  } catch (e) {}
}

// Helper: Check and trigger Payment Due alerts for active user
export function checkAndTriggerPaymentDueAlerts(currentUser: User | null, groups: ChamaGroup[]) {
  if (!currentUser) return;

  const now = Date.now();
  const lastCheck = localStorage.getItem(`buyoll_last_due_check_${currentUser.id}`);
  // Only check once every 4 hours to avoid notification spam
  if (lastCheck && now - Number(lastCheck) < 4 * 60 * 60 * 1000) {
    return;
  }
  localStorage.setItem(`buyoll_last_due_check_${currentUser.id}`, String(now));

  for (const group of groups) {
    const mySlot = group.slots.find((s) => s.userId === currentUser.id && s.status === 'active');
    if (mySlot) {
      const cycleDays = group.cycleDays || group.size;
      const paidDaysCount = mySlot.paidDays ? mySlot.paidDays.length : 0;

      if (paidDaysCount < cycleDays) {
        // Trigger Payment Due visual alert
        triggerVisualPushAlert({
          title: `⏰ Payment Due: ${group.name}`,
          body: `Reminder: Daily installment of KSh ${group.dailyAmount.toLocaleString()} is due for Slot #${mySlot.slotNumber}. Keep your contribution streak clean!`,
          url: `/chama/${group.id}`,
          groupId: group.id,
          type: 'payment_due',
        });
      }
    }
  }
}
