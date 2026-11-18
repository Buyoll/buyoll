import React, { useState, useEffect, useCallback } from 'react';
import {
  Announcement,
  AnnouncementAudience,
  AnnouncementLifecycleStatus,
  AnnouncementType,
} from '../types.ts';
import { api, resolveImageUrl } from '../api.ts';
import {
  Plus,
  Edit3,
  Trash2,
  Pin,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Upload,
  CheckCircle2,
  Clock,
  Archive,
  X,
  Megaphone,
  Search,
  RefreshCw,
} from 'lucide-react';

interface AdminAnnouncementsManagerProps {
  onNotify: (type: 'success' | 'error' | 'info', msg: string) => void;
}

const EMPTY_FORM = {
  title: '',
  body: '',
  type: 'ANNOUNCEMENT' as AnnouncementType,
  audience: 'ALL' as AnnouncementAudience,
  pinned: false,
  startsAt: '',
  endsAt: '',
  ctaLabel: '',
  ctaUrl: '',
  imageUrl: '',
  publishNow: true,
};

export const AdminAnnouncementsManager: React.FC<AdminAnnouncementsManagerProps> = ({
  onNotify,
}) => {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'ALL' | AnnouncementLifecycleStatus>('ALL');
  const [search, setSearch] = useState('');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'unpublish' | 'archive';
    item: Announcement;
  } | null>(null);

  const loadAnnouncements = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getAdminAnnouncements({
        status: statusFilter,
        search: search.trim() || undefined,
      });
      setItems(res.announcements || []);
    } catch (err: any) {
      const msg = err?.message || 'Failed to load announcements';
      setLoadError(msg);
      onNotify('error', msg);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, onNotify]);

  useEffect(() => {
    loadAnnouncements();
  }, [loadAnnouncements]);

  function openCreateModal() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setIsModalOpen(true);
  }

  function openEditModal(item: Announcement) {
    setEditingId(item.id);
    setForm({
      title: item.title || '',
      body: item.body || '',
      type: (item.type || 'ANNOUNCEMENT') as AnnouncementType,
      audience: (item.audience || 'ALL') as AnnouncementAudience,
      pinned: Boolean(item.pinned),
      startsAt: item.startsAt ? new Date(item.startsAt).toISOString().slice(0, 16) : '',
      endsAt: item.endsAt ? new Date(item.endsAt).toISOString().slice(0, 16) : '',
      ctaLabel: item.ctaLabel || '',
      ctaUrl: item.ctaUrl || '',
      imageUrl: item.imageUrl || '',
      publishNow: item.status === 'PUBLISHED',
    });
    setIsModalOpen(true);
  }

  async function handleImageFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(file.type)) {
      onNotify('error', 'Only JPG, PNG, or WebP promotional images are supported.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      onNotify('error', 'Promotional image must be 3 MB or smaller.');
      return;
    }

    setUploadingImage(true);
    try {
      const uploaded = await api.uploadAdminAnnouncementImage(file);
      setForm((prev) => ({ ...prev, imageUrl: uploaded.url }));
      onNotify('success', 'Promotional image uploaded.');
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to upload image.');
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) {
      onNotify('error', 'Title and body are required.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        title: form.title.trim(),
        body: form.body.trim(),
        type: form.type,
        audience: form.audience,
        pinned: form.pinned,
        startsAt: form.startsAt ? new Date(form.startsAt).getTime() : null,
        endsAt: form.endsAt ? new Date(form.endsAt).getTime() : null,
        ctaLabel: form.ctaLabel.trim() || undefined,
        ctaUrl: form.ctaUrl.trim() || undefined,
        imageUrl: form.imageUrl.trim() || null,
      };

      if (editingId !== null) {
        await api.updateAdminAnnouncement(editingId, {
          ...payload,
          status: form.publishNow ? 'PUBLISHED' : 'DRAFT',
        });
        onNotify('success', 'Announcement updated successfully.');
      } else {
        await api.createAdminAnnouncement({
          ...payload,
          publishNow: form.publishNow,
        });
        onNotify('success', form.publishNow ? 'Announcement published live.' : 'Announcement saved as draft.');
      }
      setIsModalOpen(false);
      await loadAnnouncements();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to save announcement.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePublish(item: Announcement) {
    try {
      await api.publishAdminAnnouncement(item.id);
      onNotify('success', `"${item.title}" published live.`);
      await loadAnnouncements();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to publish.');
    }
  }

  async function handlePinToggle(item: Announcement) {
    try {
      await api.pinAdminAnnouncement(item.id, !item.pinned);
      onNotify('success', item.pinned ? 'Announcement unpinned.' : 'Announcement pinned to top.');
      await loadAnnouncements();
    } catch (err: any) {
      onNotify('error', err.message || 'Failed to update pin status.');
    }
  }

  async function executeConfirmedAction() {
    if (!confirmAction) return;
    try {
      if (confirmAction.type === 'unpublish') {
        await api.unpublishAdminAnnouncement(confirmAction.item.id, false);
        onNotify('info', `"${confirmAction.item.title}" pulled down to Draft.`);
      } else {
        await api.archiveAdminAnnouncement(confirmAction.item.id);
        onNotify('info', `"${confirmAction.item.title}" archived.`);
      }
      setConfirmAction(null);
      await loadAnnouncements();
    } catch (err: any) {
      onNotify('error', err.message || 'Action failed.');
    }
  }

  const statusBadge = (status?: string) => {
    switch (status) {
      case 'PUBLISHED':
        return 'bg-emerald-100 text-emerald-800';
      case 'SCHEDULED':
        return 'bg-sky-100 text-sky-800';
      case 'ARCHIVED':
        return 'bg-slate-200 text-slate-600';
      default:
        return 'bg-amber-100 text-amber-800';
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="p-2 bg-orange-50 text-[#ff6600] rounded-xl">
              <Megaphone className="w-4 h-4" />
            </span>
            <h3 className="text-base font-extrabold text-slate-900">
              Platform Notices, Announcements & Promotional Banners
            </h3>
            <span className="px-2 py-0.5 bg-slate-900 text-white text-[10px] font-bold rounded-md">
              Admin Only
            </span>
          </div>
          <p className="text-xs text-slate-500">
            Create text notices or upload promotional banner images. Pull down, schedule, pin, or archive items immediately across the marketplace.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={loadAnnouncements}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-[#ff6600] hover:bg-[#e85d00] text-white rounded-xl shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New Announcement / Promo</span>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['ALL', 'PUBLISHED', 'SCHEDULED', 'DRAFT', 'ARCHIVED'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                statusFilter === tab
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {tab === 'ALL' ? 'All Items' : tab.charAt(0) + tab.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title or body..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-[#ff6600]"
          />
        </div>
      </div>

      {/* Table / Cards List */}
      {loading ? (
        <div className="py-10 text-center text-xs text-slate-500">Loading announcements...</div>
      ) : loadError ? (
        <div className="py-8 px-4 text-center border border-red-200 rounded-xl bg-red-50/70 space-y-3">
          <p className="text-xs font-bold text-red-800">{loadError}</p>
          <button
            type="button"
            onClick={loadAnnouncements}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#ff6600] hover:bg-[#ff8000] text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
          <Megaphone className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <p className="text-xs font-semibold text-slate-600">No notices or announcements found for this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div
              key={item.id}
              className="border border-slate-200 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-slate-300 transition-colors"
            >
              <div className="flex items-start gap-3.5 min-w-0 flex-1">
                {item.imageUrl ? (
                  <img
                    src={resolveImageUrl(item.imageUrl)}
                    alt={item.title}
                    className="w-20 h-16 rounded-lg object-cover border border-slate-200 shrink-0"
                  />
                ) : (
                  <div className="w-20 h-16 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-[#ff6600] shrink-0">
                    <Megaphone className="w-5 h-5" />
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${statusBadge(item.status)}`}>
                      {item.status || 'PUBLISHED'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-slate-100 text-slate-700 rounded-md">
                      {item.type || 'ANNOUNCEMENT'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-semibold bg-indigo-50 text-indigo-700 rounded-md">
                      Audience: {item.audience || 'ALL'}
                    </span>
                    {item.pinned && (
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold bg-[#ff6600] text-white rounded-md">
                        <Pin className="w-2.5 h-2.5" /> Pinned
                      </span>
                    )}
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 truncate">{item.title}</h4>
                  <p className="text-xs text-slate-600 line-clamp-2 mt-0.5">{item.body}</p>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 mt-1.5">
                    <span>Updated {new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</span>
                    {item.startsAt && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Starts {new Date(item.startsAt).toLocaleString()}
                      </span>
                    )}
                    {item.endsAt && (
                      <span className="inline-flex items-center gap-1 text-amber-600">
                        <Clock className="w-3 h-3" /> Ends {new Date(item.endsAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => handlePinToggle(item)}
                  className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                    item.pinned
                      ? 'bg-orange-50 border-orange-200 text-[#ff6600]'
                      : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                  title={item.pinned ? 'Unpin' : 'Pin to top'}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => openEditModal(item)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit</span>
                </button>
                {item.status !== 'PUBLISHED' ? (
                  <button
                    type="button"
                    onClick={() => handlePublish(item)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Publish</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmAction({ type: 'unpublish', item })}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 rounded-lg cursor-pointer"
                  >
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Pull Down</span>
                  </button>
                )}
                {item.status !== 'ARCHIVED' && (
                  <button
                    type="button"
                    onClick={() => setConfirmAction({ type: 'archive', item })}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-lg cursor-pointer"
                    title="Archive announcement"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="text-base font-extrabold text-slate-900">
                {editingId !== null ? 'Edit Notice / Announcement' : 'Create Notice, Announcement or Promotional Banner'}
              </h3>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Type</label>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AnnouncementType }))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#ff6600]"
                  >
                    <option value="ANNOUNCEMENT">Announcement</option>
                    <option value="NOTICE">Official Notice</option>
                    <option value="PROMOTION">Promotional Banner (Image + CTA)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Audience</label>
                  <select
                    value={form.audience}
                    onChange={(e) => setForm((f) => ({ ...f, audience: e.target.value as AnnouncementAudience }))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#ff6600]"
                  >
                    <option value="ALL">All Visitors, Members & Merchants</option>
                    <option value="MEMBERS">Members Only</option>
                    <option value="MERCHANTS">Merchants Only</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  maxLength={120}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Festive Mega Flash Deals or New Payment Policy"
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">
                  Message / Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  rows={4}
                  maxLength={3000}
                  value={form.body}
                  onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                  placeholder="Write your notice, promotion details, or policy update..."
                  required
                  className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                />
              </div>

              {/* Promotional Image Upload */}
              <div className="p-4 border border-dashed border-slate-300 rounded-xl bg-slate-50/70 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-[#ff6600]" />
                    <span className="text-xs font-bold text-slate-800">
                      Promotional Image / Banner (Optional)
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500">JPG, PNG, WebP · Max 3 MB</span>
                </div>

                {form.imageUrl && (
                  <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-white">
                    <img
                      src={resolveImageUrl(form.imageUrl)}
                      alt="Promotional preview"
                      className="w-full max-h-48 object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, imageUrl: '' }))}
                      className="absolute top-2 right-2 p-1.5 bg-black/70 text-white rounded-lg hover:bg-red-600 cursor-pointer"
                      title="Remove promotional image"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
                  <label className="flex items-center justify-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-300 rounded-xl text-xs font-bold text-slate-700 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5 text-[#ff6600]" />
                    <span>{uploadingImage ? 'Uploading...' : 'Upload Image File'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageFileChange}
                      disabled={uploadingImage}
                      className="hidden"
                    />
                  </label>
                  <input
                    type="text"
                    value={form.imageUrl}
                    onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                    placeholder="Or paste /uploads/... or https:// image URL"
                    className="flex-1 px-3 py-2 text-xs border border-slate-200 rounded-xl bg-white focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">Start Date (Optional)</label>
                  <input
                    type="datetime-local"
                    value={form.startsAt}
                    onChange={(e) => setForm((f) => ({ ...f, startsAt: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">End Date (Auto-expires)</label>
                  <input
                    type="datetime-local"
                    value={form.endsAt}
                    onChange={(e) => setForm((f) => ({ ...f, endsAt: e.target.value }))}
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">CTA Button Label (Optional)</label>
                  <input
                    type="text"
                    maxLength={40}
                    value={form.ctaLabel}
                    onChange={(e) => setForm((f) => ({ ...f, ctaLabel: e.target.value }))}
                    placeholder="e.g. Shop Offer"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">CTA Link (Optional)</label>
                  <input
                    type="text"
                    value={form.ctaUrl}
                    onChange={(e) => setForm((f) => ({ ...f, ctaUrl: e.target.value }))}
                    placeholder="e.g. /groups or /announcements"
                    className="w-full px-3 py-2 text-xs border border-slate-200 rounded-xl focus:outline-none focus:border-[#ff6600]"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-5 pt-1">
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.pinned}
                    onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))}
                    className="rounded border-slate-300 text-[#ff6600] focus:ring-[#ff6600]"
                  />
                  <span>Pin to top of public Notices</span>
                </label>

                <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.publishNow}
                    onChange={(e) => setForm((f) => ({ ...f, publishNow: e.target.checked }))}
                    className="rounded border-slate-300 text-[#ff6600] focus:ring-[#ff6600]"
                  />
                  <span>Publish immediately</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || uploadingImage}
                  className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold bg-[#ff6600] hover:bg-[#e85d00] text-white rounded-xl shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>{submitting ? 'Saving...' : editingId !== null ? 'Save Changes' : form.publishNow ? 'Publish Now' : 'Save Draft'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Confirm Pull-down / Archive Modal */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 space-y-4">
            <h4 className="text-base font-extrabold text-slate-900">
              {confirmAction.type === 'unpublish' ? 'Pull Down Announcement?' : 'Archive Announcement?'}
            </h4>
            <p className="text-xs text-slate-600 leading-relaxed">
              {confirmAction.type === 'unpublish'
                ? `"${confirmAction.item.title}" will be immediately removed from the public Announcements & Notices feed and reverted to Draft.`
                : `"${confirmAction.item.title}" will be moved to Archive and hidden from public feeds. Revision and audit history are preserved.`}
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeConfirmedAction}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-xl cursor-pointer"
              >
                {confirmAction.type === 'unpublish' ? 'Confirm Pull Down' : 'Confirm Archive'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
