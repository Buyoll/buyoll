import React, { useState, useEffect } from 'react';
import { User, DeliveryAddress, MemberOrder, UserNotification, Product } from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  User as UserIcon,
  Package,
  Bell,
  Users,
  Heart,
  Store,
  MapPin,
  Clock,
  Wallet,
  Settings,
  ChevronRight,
  Shield,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  Edit2,
  ExternalLink,
  Coins,
  Sparkles,
  Phone,
  Mail,
  Calendar,
  Layers,
  ArrowRight,
  X,
  Check,
  Landmark,
} from 'lucide-react';

interface ProfilePageProps {
  currentUser: User | null;
  initialTab?: string;
  onNavigate: (view: string, arg?: any) => void;
  onOpenAuth: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onUserUpdate?: () => void;
}

type ProfileTab =
  | 'overview'
  | 'orders'
  | 'notifications'
  | 'groups'
  | 'saved'
  | 'merchants'
  | 'addresses'
  | 'personal'
  | 'recent'
  | 'settings';

export const ProfilePage: React.FC<ProfilePageProps> = ({
  currentUser,
  initialTab = 'overview',
  onNavigate,
  onOpenAuth,
  onNotify,
  onUserUpdate,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab as ProfileTab);
  const [loading, setLoading] = useState(true);

  // Profile data states
  const [addresses, setAddresses] = useState<DeliveryAddress[]>([]);
  const [orders, setOrders] = useState<MemberOrder[]>([]);
  const [myGroups, setMyGroups] = useState<any[]>([]);
  const [savedProducts, setSavedProducts] = useState<Product[]>([]);
  const [followedMerchants, setFollowedMerchants] = useState<any[]>([]);
  const [recentlyViewed, setRecentlyViewed] = useState<Product[]>([]);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [notifFilter, setNotifFilter] = useState<'all' | 'broadcast' | 'chat' | 'warning' | 'group'>('all');

  // Edit personal details form state
  const [editName, setEditName] = useState(currentUser?.name || '');
  const [editPhone, setEditPhone] = useState(currentUser?.phone || '');
  const [editEmail, setEditEmail] = useState(currentUser?.email || '');
  const [editAvatarUrl, setEditAvatarUrl] = useState(currentUser?.avatar || currentUser?.avatarUrl || '');
  const [savingPersonal, setSavingPersonal] = useState(false);

  // Address modal state
  const [showAddressModal, setShowAddressModal] = useState(false);
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);
  const [addrFullName, setAddrFullName] = useState(currentUser?.name || '');
  const [addrPhone, setAddrPhone] = useState(currentUser?.phone || '');
  const [addrCounty, setAddrCounty] = useState('Nairobi');
  const [addrCity, setAddrCity] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrIsDefault, setAddrIsDefault] = useState(true);
  const [savingAddress, setSavingAddress] = useState(false);

  // Settings state
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab as ProfileTab);
    }
  }, [initialTab]);

  const [hasLoaded, setHasLoaded] = useState(false);
  const currentUserId = currentUser?.id;

  useEffect(() => {
    if (currentUserId) {
      loadProfileData(true);
    } else {
      setLoading(false);
      setHasLoaded(true);
    }
  }, [currentUserId]);

  async function loadProfileData(isInitial = false) {
    if (isInitial || !hasLoaded) {
      setLoading(true);
    }
    try {
      const [profileRes, notifRes] = await Promise.all([
        api.getUserProfile().catch(() => null),
        api.getUserNotifications().catch(() => ({ notifications: [], unreadCount: 0 })),
      ]);

      if (profileRes) {
        setAddresses(profileRes.addresses || []);
        setOrders(profileRes.orders || []);
        setMyGroups(profileRes.myGroups || []);
        setSavedProducts(profileRes.savedProducts || []);
        setFollowedMerchants(profileRes.followedMerchants || []);
        setRecentlyViewed(profileRes.recentlyViewed || []);
        setEditName(profileRes.user.name || '');
        setEditPhone(profileRes.user.phone || '');
        setEditEmail(profileRes.user.email || '');
        setEditAvatarUrl(profileRes.user.avatar || '');
      }

      if (notifRes) {
        setNotifications(notifRes.notifications || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }

  // Personal details submit
  async function handleSavePersonal(e: React.FormEvent) {
    e.preventDefault();
    setSavingPersonal(true);
    try {
      await api.updateUserProfile({
        name: editName.trim(),
        phone: editPhone.trim(),
        email: editEmail.trim(),
        avatarUrl: editAvatarUrl.trim(),
      });
      onNotify('success', 'Profile personal details updated successfully.');
      onUserUpdate?.();
      loadProfileData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update personal details');
    } finally {
      setSavingPersonal(false);
    }
  }

  // Save address submit
  async function handleSaveAddress(e: React.FormEvent) {
    e.preventDefault();
    if (!addrFullName.trim() || !addrPhone.trim() || !addrStreet.trim() || !addrCity.trim()) {
      onNotify('error', 'Please fill in all address fields.');
      return;
    }

    setSavingAddress(true);
    try {
      if (editingAddressId) {
        await api.updateUserAddress(editingAddressId, {
          fullName: addrFullName.trim(),
          phone: addrPhone.trim(),
          county: addrCounty.trim(),
          city: addrCity.trim(),
          streetAddress: addrStreet.trim(),
          isDefault: addrIsDefault,
        });
        onNotify('success', 'Address updated successfully.');
      } else {
        await api.addUserAddress({
          fullName: addrFullName.trim(),
          phone: addrPhone.trim(),
          county: addrCounty.trim(),
          city: addrCity.trim(),
          streetAddress: addrStreet.trim(),
          isDefault: addrIsDefault,
        });
        onNotify('success', 'New delivery address added.');
      }
      setShowAddressModal(false);
      setEditingAddressId(null);
      loadProfileData();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to save address');
    } finally {
      setSavingAddress(false);
    }
  }

  async function handleDeleteAddress(id: string) {
    try {
      await api.deleteUserAddress(id);
      setAddresses(prev => prev.filter(a => a.id !== id));
      onNotify('success', 'Address removed.');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to remove address');
    }
  }

  async function handleRemoveSavedItem(productId: number) {
    try {
      await api.removeSavedItem(productId);
      setSavedProducts(prev => prev.filter(p => p.id !== productId));
      onNotify('info', 'Item removed from wishlist.');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update wishlist');
    }
  }

  async function handleUnfollowMerchant(merchantId: number) {
    try {
      await api.unfollowMerchant(merchantId);
      setFollowedMerchants(prev => prev.filter(m => m.id !== merchantId));
      onNotify('info', 'Merchant unfollowed.');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to unfollow merchant');
    }
  }

  async function handleMarkNotifRead(id: string | number) {
    try {
      await api.markNotificationRead(id);
      setNotifications(prev =>
        prev.map(n => (n.id === id ? { ...n, read: true } : n))
      );
    } catch {
      // ignore
    }
  }

  async function handleMarkAllNotifsRead() {
    try {
      await api.markAllNotificationsRead();
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      onNotify('success', 'All notifications marked as read.');
    } catch {
      // ignore
    }
  }

  async function handleClearNotifs() {
    try {
      await api.clearUserNotifications();
      setNotifications([]);
      onNotify('info', 'Notifications cleared.');
    } catch {
      // ignore
    }
  }

  if (!currentUser) {
    return (
      <div className="max-w-md mx-auto px-4 py-20 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] rounded-2xl flex items-center justify-center mx-auto mb-4">
          <UserIcon className="w-8 h-8" />
        </div>
        <h2 className="text-xl font-bold text-slate-900 dark:text-white mb-2">Member Profile</h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-6 leading-relaxed">
          Sign in to access your personal dashboard, track your Chama purchases, view private notifications, and manage saved delivery addresses.
        </p>
        <button
          onClick={onOpenAuth}
          className="px-6 py-2.5 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl shadow-sm transition-all"
        >
          Sign In / Create Account
        </button>
      </div>
    );
  }

  const unreadNotifCount = notifications.filter(n => !n.read).length;
  const filteredNotifs = notifications.filter(n => {
    if (notifFilter === 'all') return true;
    return n.type === notifFilter;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Top Banner / User Identification Bar */}
      <div className="bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl p-5 sm:p-6 mb-6 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#0E5A3C] text-white font-black text-xl flex items-center justify-center shrink-0 shadow-sm overflow-hidden">
            {currentUser.avatar || currentUser.avatarUrl ? (
              <img
                src={resolveImageUrl(currentUser.avatar || currentUser.avatarUrl)}
                alt={currentUser.name}
                className="w-full h-full object-cover"
              />
            ) : (
              currentUser.name.slice(0, 2).toUpperCase()
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                {currentUser.name}
              </h1>
              <span className="px-2.5 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] text-[10px] font-black uppercase rounded-full tracking-wider">
                {currentUser.role}
              </span>
              {currentUser.verified && (
                <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 text-[10px] font-bold rounded-full flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Buyoll Verified</span>
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 mt-1 flex-wrap">
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3 text-slate-400" />
                <span>{currentUser.phone}</span>
              </span>
              {currentUser.email && (
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3 text-slate-400" />
                  <span>{currentUser.email}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Quick Balance & Space Shortcuts */}
        <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
          <div className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] rounded-xl px-4 py-2 text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Wallet Credit</span>
            <span className="text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
              KSh {(currentUser.credit || 0).toLocaleString()}
            </span>
          </div>

          <div className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] rounded-xl px-4 py-2 text-right">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Coins &amp; Points</span>
            <span className="text-sm font-black text-amber-500 tabular-nums">
              {currentUser.coins || 0}c · {currentUser.points || 0}pts
            </span>
          </div>

          {currentUser.role === 'merchant' && (
            <button
              onClick={() => onNavigate('vendor-dashboard')}
              className="px-3.5 py-2.5 bg-slate-900 hover:bg-[#FF6A00] text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Store className="w-4 h-4" />
              <span>Merchant Desk</span>
            </button>
          )}

          {currentUser.role === 'lender' && (
            <button
              onClick={() => onNavigate('lenders-dashboard')}
              className="px-3.5 py-2.5 bg-slate-900 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl transition-colors flex items-center gap-1.5 shrink-0"
            >
              <Landmark className="w-4 h-4" />
              <span>Lenders Hub</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Jumia-Style Customer Dashboard Layout (Sidebar + Content Panel) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Navigation Sidebar (mimics familiar Jumia customer dashboard) */}
        <aside className="lg:col-span-3 bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl p-3 shadow-2xs">
          <div className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase tracking-wider">
            My Buyoll Account
          </div>

          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'overview'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <UserIcon className="w-4 h-4" />
                <span>Account Overview</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => setActiveTab('orders')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'orders'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Package className="w-4 h-4" />
                <span>Orders &amp; Chama Purchases</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {orders.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('notifications')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'notifications'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Bell className="w-4 h-4" />
                <span>Notifications (Part A)</span>
              </div>
              {unreadNotifCount > 0 ? (
                <span className="text-[10px] font-black px-1.5 py-0.2 rounded-full bg-red-600 text-white animate-pulse">
                  {unreadNotifCount}
                </span>
              ) : (
                <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  {notifications.length}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('groups')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'groups'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Users className="w-4 h-4" />
                <span>My Chama Groups</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {myGroups.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('saved')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'saved'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Heart className="w-4 h-4" />
                <span>Saved Items (Wishlist)</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {savedProducts.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('merchants')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'merchants'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Store className="w-4 h-4" />
                <span>Followed Merchants</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {followedMerchants.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('addresses')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'addresses'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <MapPin className="w-4 h-4" />
                <span>Address Book</span>
              </div>
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                {addresses.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('personal')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'personal'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Edit2 className="w-4 h-4" />
                <span>Personal Details</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => setActiveTab('recent')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'recent'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Clock className="w-4 h-4" />
                <span>Recently Viewed</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => onNavigate('wallet')}
              className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Wallet className="w-4 h-4 text-[#0E5A3C] dark:text-[#4ADE9A]" />
                <span>Wallet &amp; Statements</span>
              </div>
              <ExternalLink className="w-3.5 h-3.5 opacity-60" />
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-colors ${
                activeTab === 'settings'
                  ? 'bg-[#0E5A3C] text-white font-bold shadow-xs'
                  : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-[#16221E]'
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Settings className="w-4 h-4" />
                <span>Account Settings</span>
              </div>
              <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            </button>
          </nav>
        </aside>

        {/* Right Content Panel */}
        <div className="lg:col-span-9 bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl p-5 sm:p-7 shadow-2xs min-h-[500px]">
          {/* TAB 1: ACCOUNT OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Account Overview
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Welcome to your Buyoll customer dashboard. Manage purchases, Chama savings, and delivery preferences.
                </p>
              </div>

              {/* 4 Overview Metric Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                <div
                  onClick={() => setActiveTab('orders')}
                  className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] p-4 rounded-xl cursor-pointer hover:border-[#0E5A3C] transition-all"
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Orders</span>
                  <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{orders.length}</div>
                  <span className="text-[11px] text-[#0E5A3C] dark:text-[#4ADE9A] font-semibold flex items-center gap-1 mt-1">
                    <span>View purchases</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>

                <div
                  onClick={() => setActiveTab('groups')}
                  className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] p-4 rounded-xl cursor-pointer hover:border-[#0E5A3C] transition-all"
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Active Chamas</span>
                  <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{myGroups.length}</div>
                  <span className="text-[11px] text-[#0E5A3C] dark:text-[#4ADE9A] font-semibold flex items-center gap-1 mt-1">
                    <span>Track cycles</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>

                <div
                  onClick={() => setActiveTab('saved')}
                  className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] p-4 rounded-xl cursor-pointer hover:border-[#0E5A3C] transition-all"
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Wishlist</span>
                  <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{savedProducts.length}</div>
                  <span className="text-[11px] text-[#0E5A3C] dark:text-[#4ADE9A] font-semibold flex items-center gap-1 mt-1">
                    <span>Saved items</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>

                <div
                  onClick={() => setActiveTab('notifications')}
                  className="bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] p-4 rounded-xl cursor-pointer hover:border-[#0E5A3C] transition-all"
                >
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Notifications</span>
                  <div className="text-xl font-black text-slate-900 dark:text-white tabular-nums">{unreadNotifCount}</div>
                  <span className="text-[11px] text-red-600 dark:text-red-400 font-semibold flex items-center gap-1 mt-1">
                    <span>{unreadNotifCount} unread</span>
                    <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              {/* Two Column Section: Personal Info + Default Address */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-slate-200 dark:border-[#24312C] rounded-xl p-4 bg-slate-50/50 dark:bg-[#16221E]/50">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-[#24312C]">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Account Details
                    </h3>
                    <button
                      onClick={() => setActiveTab('personal')}
                      className="text-xs text-[#0E5A3C] dark:text-[#4ADE9A] font-semibold hover:underline"
                    >
                      Edit
                    </button>
                  </div>
                  <p className="text-xs font-bold text-slate-900 dark:text-white mb-0.5">{currentUser.name}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">{currentUser.phone}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{currentUser.email || 'No email recorded'}</p>
                </div>

                <div className="border border-slate-200 dark:border-[#24312C] rounded-xl p-4 bg-slate-50/50 dark:bg-[#16221E]/50">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-100 dark:border-[#24312C]">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                      Default Delivery Address
                    </h3>
                    <button
                      onClick={() => setActiveTab('addresses')}
                      className="text-xs text-[#0E5A3C] dark:text-[#4ADE9A] font-semibold hover:underline"
                    >
                      Manage
                    </button>
                  </div>
                  {addresses.find(a => a.isDefault) || addresses[0] ? (
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-white">
                        {(addresses.find(a => a.isDefault) || addresses[0]).fullName}
                      </p>
                      <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                        {(addresses.find(a => a.isDefault) || addresses[0]).streetAddress},{' '}
                        {(addresses.find(a => a.isDefault) || addresses[0]).city},{' '}
                        {(addresses.find(a => a.isDefault) || addresses[0]).county}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        {(addresses.find(a => a.isDefault) || addresses[0]).phone}
                      </p>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 py-2">
                      No delivery address saved yet.{' '}
                      <button onClick={() => setActiveTab('addresses')} className="text-[#0E5A3C] font-bold underline">
                        Add one now
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Orders Preview */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                    Recent Chama Orders &amp; Purchases
                  </h3>
                  {orders.length > 0 && (
                    <button
                      onClick={() => setActiveTab('orders')}
                      className="text-xs font-semibold text-[#0E5A3C] dark:text-[#4ADE9A] hover:underline"
                    >
                      View all ({orders.length})
                    </button>
                  )}
                </div>

                {orders.length === 0 ? (
                  <div className="p-8 text-center bg-slate-50 dark:bg-[#16221E] rounded-xl border border-dashed border-slate-200 dark:border-[#24312C]">
                    <Package className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">No purchases yet.</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">Join a Chama group inside any product to begin your purchase.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {orders.slice(0, 3).map((ord) => (
                      <div
                        key={ord.id}
                        onClick={() => onNavigate('group', ord.groupId)}
                        className="p-3.5 bg-slate-50 dark:bg-[#16221E] border border-slate-200 dark:border-[#24312C] rounded-xl flex items-center justify-between gap-3 cursor-pointer hover:border-[#0E5A3C] transition-all"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {ord.productImage && (
                            <img
                              src={resolveImageUrl(ord.productImage)}
                              alt={ord.productTitle}
                              className="w-12 h-12 object-cover rounded-lg shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                              {ord.productTitle}
                            </h4>
                            <p className="text-[11px] text-slate-500 truncate">
                              {ord.groupName} · Slot #{ord.slotNumber} ({ord.speed}-member speed)
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-xs font-black text-slate-900 dark:text-white block tabular-nums">
                            KSh {ord.productPrice.toLocaleString()}
                          </span>
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full uppercase">
                            {ord.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: ORDERS (PURCHASES THROUGH GROUPS - STRICTLY NO CART) */}
          {activeTab === 'orders' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Orders &amp; Chama Purchases
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every product on Buyoll is purchased through a Chama group vehicle. Track installment progress and scheduled product release.
                </p>
              </div>

              {orders.length === 0 ? (
                <div className="py-16 text-center">
                  <Package className="w-12 h-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">You haven't made any purchases yet.</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1 mb-4">
                    Explore products in the marketplace and join an open group to activate your order.
                  </p>
                  <button
                    onClick={() => onNavigate('home')}
                    className="px-5 py-2.5 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl shadow-sm"
                  >
                    Browse Live Marketplace
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {orders.map((ord) => (
                    <div
                      key={ord.id}
                      className="border border-slate-200 dark:border-[#24312C] rounded-2xl p-4 sm:p-5 bg-slate-50/40 dark:bg-[#16221E]/40"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-200/60 dark:border-slate-800 mb-4">
                        <div>
                          <span className="text-[10px] font-mono text-slate-400 uppercase">
                            Order #{ord.id} · Placed {new Date(ord.createdAt).toLocaleDateString()}
                          </span>
                          <h4 className="text-sm font-black text-slate-900 dark:text-white">{ord.productTitle}</h4>
                        </div>
                        <span className="self-start sm:self-auto px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950 text-[#0E5A3C] dark:text-[#4ADE9A] font-bold text-xs rounded-full uppercase tracking-wider">
                          Status: {ord.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                        <div className="md:col-span-3">
                          {ord.productImage && (
                            <img
                              src={resolveImageUrl(ord.productImage)}
                              alt={ord.productTitle}
                              className="w-full h-28 object-cover rounded-xl"
                            />
                          )}
                        </div>
                        <div className="md:col-span-6 space-y-1.5 text-xs">
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Chama Group:</span>
                            <span className="font-bold text-slate-900 dark:text-white">{ord.groupName}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Rotation Slot:</span>
                            <span className="font-bold text-[#0E5A3C] dark:text-[#4ADE9A]">Member Slot #{ord.slotNumber} of {ord.speed}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-500">Contribution Progress:</span>
                            <span className="font-bold tabular-nums">
                              KSh {(ord.totalPaid || 0).toLocaleString()} / KSh {ord.productPrice.toLocaleString()}
                            </span>
                          </div>
                          <div className="w-full bg-slate-200 dark:bg-slate-700 h-2 rounded-full overflow-hidden mt-1">
                            <div
                              className="bg-[#0E5A3C] dark:bg-[#4ADE9A] h-full transition-all"
                              style={{ width: `${Math.min(100, Math.round(((ord.totalPaid || 0) / ord.productPrice) * 100))}%` }}
                            />
                          </div>
                        </div>
                        <div className="md:col-span-3 text-right flex flex-col justify-between h-full gap-2">
                          <div>
                            <span className="text-xs text-slate-400 block">Total Target</span>
                            <span className="text-base font-black text-slate-900 dark:text-white tabular-nums">
                              KSh {ord.productPrice.toLocaleString()}
                            </span>
                          </div>
                          <button
                            onClick={() => onNavigate('group', ord.groupId)}
                            className="w-full py-2 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <span>Open Chama</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: NOTIFICATIONS (PART A - PRIVATE AT PROFILE LEVEL) */}
          {activeTab === 'notifications' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-[#24312C] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                      Private Notifications &amp; Alerts
                    </h2>
                    {unreadNotifCount > 0 && (
                      <span className="px-2 py-0.5 bg-red-600 text-white font-bold text-[10px] rounded-full">
                        {unreadNotifCount} unread
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Communication concerning you personally: group notices, moderator messages, warnings, chat links, and admin broadcasts.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {unreadNotifCount > 0 && (
                    <button
                      onClick={handleMarkAllNotifsRead}
                      className="px-3 py-1.5 text-xs font-semibold text-[#0E5A3C] dark:text-[#4ADE9A] hover:bg-emerald-50 dark:hover:bg-emerald-950/30 rounded-lg transition-colors cursor-pointer"
                    >
                      Mark All Read
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={handleClearNotifs}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-500 hover:text-red-600 rounded-lg transition-colors cursor-pointer"
                    >
                      Clear All
                    </button>
                  )}
                </div>
              </div>

              {/* Notification Filter Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none text-xs">
                {(['all', 'broadcast', 'chat', 'warning', 'group'] as const).map((filterKey) => (
                  <button
                    key={filterKey}
                    onClick={() => setNotifFilter(filterKey)}
                    className={`px-3 py-1.5 rounded-lg capitalize font-bold transition-colors whitespace-nowrap cursor-pointer ${
                      notifFilter === filterKey
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-xs'
                        : 'bg-slate-100 dark:bg-[#16221E] text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                    }`}
                  >
                    {filterKey === 'broadcast' ? 'Admin Broadcasts' : filterKey}
                  </button>
                ))}
              </div>

              {filteredNotifs.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Bell className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">No notifications in this filter.</p>
                  <p className="text-[11px] mt-0.5">You are fully up to date with your Chamas and account.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {filteredNotifs.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => {
                        handleMarkNotifRead(notif.id);
                        if (notif.link) {
                          const chamaMatch = notif.link.match(/\/chama\/(\d+)/);
                          if (chamaMatch) onNavigate('group', Number(chamaMatch[1]));
                          else if (notif.link.includes('announcements')) onNavigate('home');
                          else if (notif.link.includes('wallet')) onNavigate('wallet');
                        }
                      }}
                      className={`p-4 rounded-xl border transition-all cursor-pointer ${
                        !notif.read
                          ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/50'
                          : 'bg-slate-50/40 dark:bg-[#16221E]/40 border-slate-200 dark:border-[#24312C]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <span className="text-lg shrink-0 mt-0.5">
                            {notif.type === 'warning'
                              ? '⚠️'
                              : notif.type === 'broadcast'
                              ? '📢'
                              : notif.type === 'chat'
                              ? '💬'
                              : notif.type === 'verification'
                              ? '🌟'
                              : '🔔'}
                          </span>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs font-extrabold text-slate-900 dark:text-white">
                                {notif.title}
                              </h4>
                              {!notif.read && (
                                <span className="w-2 h-2 rounded-full bg-emerald-600 shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                              {notif.message}
                            </p>
                            {notif.link && (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#0E5A3C] dark:text-[#4ADE9A] mt-2 hover:underline">
                                <span>Open details</span>
                                <ArrowRight className="w-3 h-3" />
                              </span>
                            )}
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">
                          {new Date(notif.timestamp).toLocaleDateString()}{' '}
                          {new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: MY GROUPS */}
          {activeTab === 'groups' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  My Chama Groups ({myGroups.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Every Chama you have joined across products. A member can join multiple groups freely.
                </p>
              </div>

              {myGroups.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Users className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">You have not joined any Chamas yet.</p>
                  <button
                    onClick={() => onNavigate('home')}
                    className="mt-3 px-4 py-2 bg-[#0E5A3C] text-white text-xs font-bold rounded-xl"
                  >
                    Explore Chamas to Join
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {myGroups.map((grp) => (
                    <div
                      key={grp.id}
                      onClick={() => onNavigate('group', grp.id)}
                      className="border border-slate-200 dark:border-[#24312C] rounded-2xl p-4 bg-slate-50/50 dark:bg-[#16221E]/50 hover:border-[#0E5A3C] transition-all cursor-pointer flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className={`px-2 py-0.5 text-[10px] font-black rounded-md uppercase tracking-wider ${
                            grp.role === 'moderator' ? 'bg-indigo-100 text-indigo-800' : 'bg-slate-200 text-slate-800'
                          }`}>
                            {grp.role === 'moderator' ? '👑 Group Moderator' : 'Member'}
                          </span>
                          <span className="text-[11px] font-bold text-slate-400">
                            {grp.size} Members · {grp.cycleDays}d
                          </span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white mb-1 line-clamp-1">
                          {grp.name}
                        </h4>
                        <p className="text-[11px] text-slate-500 mb-3 line-clamp-1">{grp.productTitle}</p>
                      </div>

                      <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-extrabold text-[#0E5A3C] dark:text-[#4ADE9A]">
                          Slot #{grp.slotNumber}
                        </span>
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                          <span>Enter Group</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 5: SAVED ITEMS / WISHLIST (STRICTLY NO CART) */}
          {activeTab === 'saved' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Saved Items (Wishlist)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Products you have saved for later. Join an open Chama group whenever you are ready (no cart).
                </p>
              </div>

              {savedProducts.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Heart className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">Your wishlist is empty.</p>
                  <p className="text-[11px] mt-0.5">Save items while browsing to track them here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {savedProducts.map((p) => (
                    <div
                      key={p.id}
                      className="border border-slate-200 dark:border-[#24312C] rounded-2xl overflow-hidden bg-slate-50/40 dark:bg-[#16221E]/40 flex flex-col justify-between"
                    >
                      <div>
                        <div className="aspect-4/3 w-full bg-slate-200 relative overflow-hidden">
                          <img
                            src={resolveImageUrl(p.images[0])}
                            alt={p.title}
                            className="w-full h-full object-cover"
                          />
                          <button
                            onClick={() => handleRemoveSavedItem(p.id)}
                            className="absolute top-2 right-2 p-1.5 bg-white/90 text-slate-700 hover:text-red-600 rounded-full shadow-xs cursor-pointer"
                            title="Remove from saved"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        <div className="p-3">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1 mb-1">
                            {p.title}
                          </h4>
                          <span className="text-sm font-black text-slate-900 dark:text-white block tabular-nums">
                            KSh {p.price.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 pt-0">
                        <button
                          onClick={() => onNavigate('product', p.id)}
                          className="w-full py-2 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                        >
                          Join Chama to Buy
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: FOLLOWED MERCHANTS */}
          {activeTab === 'merchants' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Followed Merchants
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Verified shops and store owners you follow on Buyoll.
                </p>
              </div>

              {followedMerchants.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Store className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">You haven't followed any merchants yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {followedMerchants.map((m) => (
                    <div
                      key={m.id}
                      className="border border-slate-200 dark:border-[#24312C] rounded-2xl p-4 flex items-center justify-between gap-3 bg-slate-50/50 dark:bg-[#16221E]/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-emerald-100 text-[#0E5A3C] font-black flex items-center justify-center shrink-0">
                          {m.shopName?.slice(0, 2).toUpperCase() || 'SH'}
                        </div>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                              {m.shopName || m.name}
                            </h4>
                            {m.verified && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-blue-500" />
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 line-clamp-1">{m.shopDescription || 'Verified Buyoll Merchant'}</p>
                          <span className="text-[10px] text-amber-500 font-bold">★ {m.rating || 5.0} Merchant Rating</span>
                        </div>
                      </div>

                      <button
                        onClick={() => handleUnfollowMerchant(m.id)}
                        className="px-3 py-1.5 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:text-red-600 text-xs font-semibold rounded-lg shrink-0 cursor-pointer"
                      >
                        Unfollow
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 7: ADDRESS BOOK */}
          {activeTab === 'addresses' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-[#24312C] pb-4">
                <div>
                  <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                    Delivery Address Book
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Saved delivery destinations for your completed Chama rotations.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingAddressId(null);
                    setAddrFullName(currentUser.name);
                    setAddrPhone(currentUser.phone);
                    setAddrCounty('Nairobi');
                    setAddrCity('');
                    setAddrStreet('');
                    setAddrIsDefault(addresses.length === 0);
                    setShowAddressModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl cursor-pointer shadow-xs"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add New Address</span>
                </button>
              </div>

              {addresses.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <MapPin className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">No addresses saved yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {addresses.map((addr) => (
                    <div
                      key={addr.id}
                      className={`border rounded-2xl p-4 flex flex-col justify-between ${
                        addr.isDefault
                          ? 'border-[#0E5A3C] bg-emerald-50/30 dark:bg-emerald-950/20'
                          : 'border-slate-200 dark:border-[#24312C] bg-slate-50/40 dark:bg-[#16221E]/40'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white">{addr.fullName}</h4>
                          {addr.isDefault && (
                            <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-black rounded-full uppercase">
                              Default
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mb-1">{addr.streetAddress}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {addr.city}, {addr.county}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-slate-400" />
                          <span>{addr.phone}</span>
                        </p>
                      </div>

                      <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800 mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => {
                            setEditingAddressId(addr.id);
                            setAddrFullName(addr.fullName);
                            setAddrPhone(addr.phone);
                            setAddrCounty(addr.county);
                            setAddrCity(addr.city);
                            setAddrStreet(addr.streetAddress);
                            setAddrIsDefault(addr.isDefault);
                            setShowAddressModal(true);
                          }}
                          className="text-xs text-[#0E5A3C] font-semibold hover:underline cursor-pointer"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteAddress(addr.id)}
                          className="text-xs text-red-600 font-semibold hover:underline ml-2 cursor-pointer"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 8: PERSONAL DETAILS */}
          {activeTab === 'personal' && (
            <div className="space-y-5 max-w-lg">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Personal Details
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Update your contact details and display photo. Login credentials remain secure and untouched.
                </p>
              </div>

              <form onSubmit={handleSavePersonal} className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-[#16221E] text-slate-900 dark:text-white focus:outline-none focus:border-[#0E5A3C]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Phone Number (M-Pesa registered)
                  </label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-[#16221E] text-slate-900 dark:text-white focus:outline-none focus:border-[#0E5A3C]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-[#16221E] text-slate-900 dark:text-white focus:outline-none focus:border-[#0E5A3C]"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                    Profile Photo URL
                  </label>
                  <input
                    type="url"
                    value={editAvatarUrl}
                    onChange={(e) => setEditAvatarUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full px-3.5 py-2.5 text-xs border border-slate-300 dark:border-slate-700 rounded-xl bg-white dark:bg-[#16221E] text-slate-900 dark:text-white focus:outline-none focus:border-[#0E5A3C]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={savingPersonal}
                  className="px-6 py-2.5 bg-[#0E5A3C] hover:bg-[#0a422c] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer shadow-sm disabled:opacity-50"
                >
                  {savingPersonal ? 'Saving Details...' : 'Save Personal Details'}
                </button>
              </form>
            </div>
          )}

          {/* TAB 9: RECENTLY VIEWED */}
          {activeTab === 'recent' && (
            <div className="space-y-4">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Recently Viewed Products
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Products you opened during recent browsing sessions.
                </p>
              </div>

              {recentlyViewed.length === 0 ? (
                <div className="py-16 text-center text-slate-400">
                  <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-xs font-semibold">No recent browsing history.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  {recentlyViewed.map((p) => (
                    <div
                      key={p.id}
                      className="border border-slate-200 dark:border-[#24312C] rounded-2xl overflow-hidden bg-slate-50/40 dark:bg-[#16221E]/40 flex flex-col justify-between"
                    >
                      <div>
                        <div className="aspect-4/3 w-full bg-slate-200 overflow-hidden">
                          <img
                            src={resolveImageUrl(p.images[0])}
                            alt={p.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="p-3">
                          <h4 className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1 mb-1">
                            {p.title}
                          </h4>
                          <span className="text-sm font-black text-slate-900 dark:text-white block tabular-nums">
                            KSh {p.price.toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <div className="p-3 pt-0">
                        <button
                          onClick={() => onNavigate('product', p.id)}
                          className="w-full py-2 bg-slate-900 hover:bg-[#0E5A3C] text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                        >
                          View Details &amp; Chamas
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 10: ACCOUNT SETTINGS */}
          {activeTab === 'settings' && (
            <div className="space-y-6 max-w-lg">
              <div className="border-b border-slate-100 dark:border-[#24312C] pb-4">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  Account Preferences &amp; Settings
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Manage communications, alerts, and platform behavior.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#16221E] rounded-xl border border-slate-200 dark:border-[#24312C]">
                  <div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      In-App &amp; Push Notifications
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Receive alerts when your Chama day arrives or when members pay.
                    </span>
                  </div>
                  <button
                    onClick={() => setPushEnabled(!pushEnabled)}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                      pushEnabled ? 'bg-[#0E5A3C]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        pushEnabled ? 'right-1' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-[#16221E] rounded-xl border border-slate-200 dark:border-[#24312C]">
                  <div>
                    <span className="text-xs font-bold text-slate-900 dark:text-white block">
                      SMS Payment Reminders
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Receive daily SMS reminders for Till 196853 installments.
                    </span>
                  </div>
                  <button
                    onClick={() => setSmsEnabled(!smsEnabled)}
                    className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer ${
                      smsEnabled ? 'bg-[#0E5A3C]' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        smsEnabled ? 'right-1' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-200 dark:border-[#24312C]">
                  <h4 className="text-xs font-bold text-red-600 mb-1">Account Closing</h4>
                  <p className="text-[11px] text-slate-500 mb-3">
                    Closing your account requires completing or transferring all active Chama rotations first.
                  </p>
                  <button
                    onClick={() => onNotify('info', 'To close your account, please reach out via Help & Support with zero active arrears.')}
                    className="px-3.5 py-2 border border-red-300 text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl cursor-pointer"
                  >
                    Request Account Closing
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add / Edit Address Modal */}
      {showAddressModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111A17] border border-slate-200 dark:border-[#24312C] rounded-2xl max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#24312C] mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {editingAddressId ? 'Edit Delivery Address' : 'Add New Delivery Address'}
              </h3>
              <button onClick={() => setShowAddressModal(false)} className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveAddress} className="space-y-3.5">
              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Recipient Name</label>
                <input
                  type="text"
                  value={addrFullName}
                  onChange={(e) => setAddrFullName(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#16221E] text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">Phone Number</label>
                <input
                  type="tel"
                  value={addrPhone}
                  onChange={(e) => setAddrPhone(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#16221E] text-slate-900 dark:text-white"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">County</label>
                  <input
                    type="text"
                    value={addrCounty}
                    onChange={(e) => setAddrCounty(e.target.value)}
                    required
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#16221E] text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">City / Town</label>
                  <input
                    type="text"
                    value={addrCity}
                    onChange={(e) => setAddrCity(e.target.value)}
                    required
                    placeholder="e.g. Westlands"
                    className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#16221E] text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block mb-1">
                  Street, Building, Apartment No.
                </label>
                <input
                  type="text"
                  value={addrStreet}
                  onChange={(e) => setAddrStreet(e.target.value)}
                  required
                  placeholder="e.g. Ring Road Parklands, Plaza 4B"
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-[#16221E] text-slate-900 dark:text-white"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="addrDefault"
                  checked={addrIsDefault}
                  onChange={(e) => setAddrIsDefault(e.target.checked)}
                  className="rounded text-[#0E5A3C]"
                />
                <label htmlFor="addrDefault" className="text-xs text-slate-700 dark:text-slate-300 cursor-pointer font-medium">
                  Set as default delivery address
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100 dark:border-[#24312C]">
                <button
                  type="button"
                  onClick={() => setShowAddressModal(false)}
                  className="px-4 py-2 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAddress}
                  className="px-5 py-2 bg-[#0E5A3C] text-white text-xs font-bold rounded-lg hover:bg-[#0a422c]"
                >
                  {savingAddress ? 'Saving...' : 'Save Address'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
