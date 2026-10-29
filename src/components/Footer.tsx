import React, { useState } from 'react';
import { resolveImageUrl } from '../api.ts';
import { X } from 'lucide-react';

interface FooterProps {
  onNavigate?: (view: string, arg?: any) => void;
  onOpenHelp?: (tab?: string) => void;
  onOpenAuth?: (role?: 'member' | 'merchant' | 'lender' | 'admin') => void;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigate,
  onOpenHelp,
  onOpenAuth,
}) => {
  const [earnModal, setEarnModal] = useState<'rider' | 'merchant' | 'referral' | 'legal' | null>(null);
  const [legalTitle, setLegalTitle] = useState<string>('Terms & Conditions');
  const [openPartner, setOpenPartner] = useState<number | null>(null);

  const partners = [
    {
      name: 'Snaptube',
      tag: 'Crowdfunding & Video',
      desc: 'A crowdfunding, YouTube-like website.',
    },
    {
      name: 'Trendier',
      tag: 'Microblogging & P2P Gaming',
      desc: 'A microblogging and peer-to-peer gaming platform.',
    },
    {
      name: 'Pesewa',
      tag: 'Fintech & Mobile Money',
      desc: 'An M-Pesa-like fintech platform.',
    },
    {
      name: 'ALO',
      tag: 'Social & Wagering',
      desc: 'A WhatsApp-like betting platform.',
    },
    {
      name: 'Airbus',
      tag: 'Hospitality & Stays',
      desc: 'A video-based short-stay rental platform.',
    },
    {
      name: 'KiloKumi',
      tag: 'Social Gaming',
      desc: 'A social betting platform.',
    },
  ];

  function openLegalDoc(title: string) {
    setLegalTitle(title);
    setEarnModal('legal');
  }

  return (
    <>
      <footer className="bg-white dark:bg-[#111A17] border-t border-[#E5E7EB] dark:border-[#24312C] text-[#4B5563] dark:text-[#9CA3AF] text-sm leading-[1.55] transition-colors duration-200">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 pt-12">
          {/* Top 4-Column Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr] gap-8 lg:gap-10">
            {/* Column 1: Brand & About */}
            <div className="space-y-3">
              <details className="group" open>
                <summary className="list-none cursor-pointer inline-flex items-center gap-3 p-1.5 pl-0 rounded-xl select-none">
                  <img
                    src={resolveImageUrl('buyoll_logo.png')}
                    alt="Buyoll"
                    className="h-14 w-auto object-contain block shrink-0"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.src.endsWith('Buyoll_Shopping_Cart_Logo_23c2cc30.png')) {
                        target.src = './assets/aistudio/Buyoll_Shopping_Cart_Logo_23c2cc30.png';
                      }
                    }}
                  />
                  <span className="font-extrabold text-[17px] text-[#111827] dark:text-[#F3F4F6] leading-tight group-hover:text-[#0F5C3A] dark:group-hover:text-[#4ADE9A] transition-colors">
                    Buyoll Social Fintech Marketplace
                  </span>
                  <svg
                    className="w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] group-open:rotate-180 transition-transform"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <p className="mt-3 text-sm text-[#4B5563] dark:text-[#9CA3AF] leading-relaxed max-w-[420px]">
                  Buyoll connects shoppers, merchants and members across Kenya through product discovery, configurable group-contribution Chama systems (from 10 members down to a 1-member Lipa Mdogomdogo), gradual payment arrangements, non-withdrawable shopping wallets and merchant-sponsored promotional incentives.
                </p>
              </details>
            </div>

            {/* Column 2: Make money with Buyoll */}
            <details className="group border-t border-[#E5E7EB] dark:border-[#24312C] pt-3.5 sm:border-t-0 sm:pt-0" open>
              <summary className="list-none cursor-pointer flex items-center justify-between mb-3 text-[12.5px] uppercase tracking-[0.08em] font-extrabold text-[#111827] dark:text-[#F3F4F6]">
                <span>Make money with Buyoll</span>
                <svg
                  className="w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] group-open:rotate-180 transition-transform sm:hidden"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <ul className="grid gap-1">
                <li>
                  <button
                    onClick={() => setEarnModal('rider')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16 9 8h4l3 8M13 8l-2-3h-2" />
                    </svg>
                    <span>Become a Rider / Delivery Partner</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => {
                      if (onOpenAuth) onOpenAuth('merchant');
                      else if (onNavigate) onNavigate('vendor-dashboard');
                      else setEarnModal('merchant');
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 9 5.5 4h13L20 9M4 9v10h16V9M4 9a2.7 2.7 0 0 0 5.3 0 2.7 2.7 0 0 0 5.4 0A2.7 2.7 0 0 0 20 9M10 19v-5h4v5" />
                    </svg>
                    <span>Become a Verified Merchant</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => setEarnModal('referral')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
                    </svg>
                    <span>Become a Referral Partner</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => {
                      if (onOpenAuth) onOpenAuth('lender');
                      else onNavigate?.('lenders-dashboard');
                    }}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 10 12 4l9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />
                    </svg>
                    <span>Serve as a 3rd-Party Group Lender (3% fee)</span>
                  </button>
                </li>
              </ul>
            </details>

            {/* Column 3: Need help & support? */}
            <details className="group border-t border-[#E5E7EB] dark:border-[#24312C] pt-3.5 sm:border-t-0 sm:pt-0" open>
              <summary className="list-none cursor-pointer flex items-center justify-between mb-3 text-[12.5px] uppercase tracking-[0.08em] font-extrabold text-[#111827] dark:text-[#F3F4F6]">
                <span>Need help &amp; support?</span>
                <svg
                  className="w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] group-open:rotate-180 transition-transform sm:hidden"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <ul className="grid gap-1">
                <li>
                  <button
                    onClick={() => onOpenHelp?.('inquiry')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 5h16v11H9l-5 4Z" />
                    </svg>
                    <span>Community Questions &amp; Feed</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => onOpenHelp?.('complaint')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16h.01" />
                    </svg>
                    <span>Complaints &amp; Dispute Feedback</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => onOpenHelp?.('faq')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" />
                    </svg>
                    <span>Frequently Asked Questions (FAQ)</span>
                  </button>
                </li>
              </ul>
              <div className="text-[11.5px] font-bold tracking-[0.06em] uppercase text-[#4B5563] dark:text-[#9CA3AF] mt-5 mb-1.5">
                Official support email
              </div>
              <a
                href="mailto:cityandcountyre@gmail.com"
                className="inline-flex gap-2 items-center text-[#0F5C3A] dark:text-[#4ADE9A] font-semibold text-sm hover:underline break-all"
              >
                <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" />
                </svg>
                <span>cityandcountyre@gmail.com</span>
              </a>
            </details>

            {/* Column 4: Legal */}
            <details className="group border-t border-[#E5E7EB] dark:border-[#24312C] pt-3.5 sm:border-t-0 sm:pt-0" open>
              <summary className="list-none cursor-pointer flex items-center justify-between mb-3 text-[12.5px] uppercase tracking-[0.08em] font-extrabold text-[#111827] dark:text-[#F3F4F6]">
                <span>Legal</span>
                <svg
                  className="w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] group-open:rotate-180 transition-transform sm:hidden"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </summary>
              <ul className="grid gap-1">
                <li>
                  <button
                    onClick={() => openLegalDoc('Terms & Conditions')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M7 3h7l4 4v14H7ZM14 3v4h4M10 12h5M10 16h5" />
                    </svg>
                    <span>Terms &amp; Conditions</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => openLegalDoc('Privacy Policy')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
                    </svg>
                    <span>Privacy Policy</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => openLegalDoc('Cookie Policy')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3a9 9 0 1 0 9 9 4 4 0 0 1-4-4 4 4 0 0 1-5-5Z" /><path d="M9 10h.01M13 15h.01M8 15h.01" />
                    </svg>
                    <span>Cookie Policy</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => openLegalDoc('Refund & Dispute Policy')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4" />
                    </svg>
                    <span>Refund &amp; Dispute Policy</span>
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => openLegalDoc('Chama & Lender Agreement')}
                    className="w-full flex items-center gap-2.5 px-2 py-1.5 -mx-2 rounded-lg text-left text-sm text-[#4B5563] dark:text-[#9CA3AF] hover:bg-[#E7F3EC] dark:hover:bg-[#1A2621] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
                  >
                    <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0Zm14 0-3 7a3 3 0 0 0 6 0Z" />
                    </svg>
                    <span>Chama &amp; Lender Agreement</span>
                  </button>
                </li>
              </ul>
            </details>
          </div>

          {/* Section: Buyoll Partners & Ecosystem */}
          <section className="mt-10 pt-8 border-t border-[#E5E7EB] dark:border-[#24312C]" aria-labelledby="pt">
            <div className="flex items-baseline gap-3 flex-wrap mb-4">
              <h3 id="pt" className="text-[12.5px] uppercase tracking-[0.08em] font-extrabold text-[#111827] dark:text-[#F3F4F6] m-0">
                Buyoll partners &amp; ecosystem
              </h3>
              <span className="text-[13.5px] text-[#4B5563] dark:text-[#9CA3AF]">
                Verified ecosystem partner platforms. Tap a partner to learn more.
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
              {partners.map((p, idx) => (
                <details
                  key={idx}
                  open={openPartner === idx}
                  className="border border-[#E5E7EB] dark:border-[#24312C] rounded-xl bg-[#F9FAFB] dark:bg-[#15201C] transition-all"
                >
                  <summary
                    onClick={(e) => {
                      e.preventDefault();
                      setOpenPartner(openPartner === idx ? null : idx);
                    }}
                    className="list-none cursor-pointer flex items-center gap-2.5 p-3 sm:px-3.5"
                  >
                    <span className="font-bold text-sm text-[#111827] dark:text-[#F3F4F6] flex-1">{p.name}</span>
                    <span className="text-[11px] font-semibold text-[#0F5C3A] dark:text-[#4ADE9A] bg-[#E7F3EC] dark:bg-[#183125] px-2.5 py-0.5 rounded-full whitespace-nowrap">
                      {p.tag}
                    </span>
                    <svg
                      className={`w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] transition-transform ${
                        openPartner === idx ? 'rotate-180' : ''
                      }`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <p className="m-0 px-3.5 pb-3.5 text-[13.5px] text-[#4B5563] dark:text-[#9CA3AF]">{p.desc}</p>
                </details>
              ))}
            </div>
          </section>

          {/* Section: Transparent Manual Payments */}
          <details className="mt-6 border border-[#E5E7EB] dark:border-[#24312C] rounded-xl bg-[#F9FAFB] dark:bg-[#15201C] group" open>
            <summary className="list-none cursor-pointer flex items-center gap-2.5 p-3.5 sm:p-4 font-bold text-sm text-[#111827] dark:text-[#F3F4F6]">
              <svg className="w-[18px] h-[18px] shrink-0 text-[#0F5C3A] dark:text-[#4ADE9A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6Z" /><path d="m9 12 2 2 4-4" />
              </svg>
              <span>Transparent Manual Payments</span>
              <svg
                className="w-4 h-4 shrink-0 text-[#4B5563] dark:text-[#9CA3AF] ml-auto group-open:rotate-180 transition-transform"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="px-4 pb-4 text-[13.5px] text-[#4B5563] dark:text-[#9CA3AF]">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-3">
                <div className="bg-white dark:bg-[#0E1613] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-2.5 sm:px-3">
                  <small className="block text-[11px] uppercase tracking-[0.06em] text-[#4B5563] dark:text-[#9CA3AF] font-medium">
                    Platform Till
                  </small>
                  <b className="text-base text-[#111827] dark:text-[#F3F4F6] tabular-nums font-mono">196853</b>
                </div>
                <div className="bg-white dark:bg-[#0E1613] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-2.5 sm:px-3">
                  <small className="block text-[11px] uppercase tracking-[0.06em] text-[#4B5563] dark:text-[#9CA3AF] font-medium">
                    Paybill (Acc: 4363)
                  </small>
                  <b className="text-base text-[#111827] dark:text-[#F3F4F6] tabular-nums font-mono">522533</b>
                </div>
                <div className="bg-white dark:bg-[#0E1613] border border-[#E5E7EB] dark:border-[#24312C] rounded-xl p-2.5 sm:px-3">
                  <small className="block text-[11px] uppercase tracking-[0.06em] text-[#4B5563] dark:text-[#9CA3AF] font-medium">
                    Merchant Till
                  </small>
                  <b className="text-base text-[#111827] dark:text-[#F3F4F6] tabular-nums font-mono">3463533</b>
                </div>
              </div>
              Payments are made manually to the Platform Till or Paybill above, or directly to the Merchant Till. Buyoll facilitates coordinated shopping and does not claim 100% escrow protection.
            </div>
          </details>

          {/* Bottom Copyright & Legal links */}
          <div className="mt-8 border-t border-[#E5E7EB] dark:border-[#24312C] py-5 sm:py-6 flex flex-col sm:flex-row justify-between items-center gap-3 text-[13px] text-[#4B5563] dark:text-[#9CA3AF]">
            <span>© 2026 Buyoll Fintech. All rights reserved. Made in Kenya.</span>
            <nav aria-label="Legal" className="flex gap-4 sm:gap-5 flex-wrap">
              <button
                onClick={() => openLegalDoc('Terms & Conditions')}
                className="text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
              >
                Terms
              </button>
              <button
                onClick={() => openLegalDoc('Privacy Policy')}
                className="text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
              >
                Privacy
              </button>
              <button
                onClick={() => openLegalDoc('Cookie Policy')}
                className="text-[#4B5563] dark:text-[#9CA3AF] hover:text-[#0F5C3A] dark:hover:text-[#4ADE9A] transition-colors"
              >
                Cookies
              </button>
            </nav>
          </div>
        </div>
      </footer>

      {/* Make Money / Legal Documentation Modal */}
      {earnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#111A17] rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 dark:border-[#24312C] animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#24312C] mb-4">
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                {earnModal === 'rider' && '🚴 Rider & Delivery Partner Onboarding'}
                {earnModal === 'merchant' && '🏪 Verified Merchant Storefront Application'}
                {earnModal === 'referral' && '🤝 Buyoll Referral Partner Program'}
                {earnModal === 'legal' && `⚖️ ${legalTitle}`}
              </h3>
              <button
                onClick={() => setEarnModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 dark:text-[#9CA3AF] leading-relaxed mb-6 max-h-[60vh] overflow-y-auto pr-1">
              {earnModal === 'rider' && (
                <>
                  <p>
                    Dispatch matured Chama products directly from verified merchant shops to rotating buyers in your neighborhood.
                  </p>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                    <span className="font-bold block mb-1">Rider Requirements:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Valid National ID & Driver/Rider License</li>
                      <li>Registered Motorbike or Bicycle with secure carrier</li>
                      <li>Smart device with active M-Pesa phone number</li>
                    </ul>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    To register, send your credentials to <b>cityandcountyre@gmail.com</b>.
                  </p>
                </>
              )}

              {earnModal === 'merchant' && (
                <>
                  <p>
                    Join verified shop owners and distributors across Kenya offering appliances, electronics, solar stations, and furniture with configurable Chama speed groups.
                  </p>
                  <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 rounded-xl border border-emerald-200 dark:border-emerald-800/60">
                    <span className="font-bold block mb-1">Merchant Privileges:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Create speed options from 10 down to 1-member solo plans</li>
                      <li>Built-in Buyoll.ai sales assistant for every product</li>
                      <li>Receive payments directly on your Merchant Till: 3463533</li>
                    </ul>
                  </div>
                </>
              )}

              {earnModal === 'referral' && (
                <>
                  <p>
                    Earn 100 Reward Coins and store credits for every active Chama member you invite who completes their first installment.
                  </p>
                  <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 rounded-xl border border-amber-200 dark:border-amber-800/60">
                    <span className="font-bold block mb-1">Referral Guidelines:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Share unique Chama invitation codes with friends and networks</li>
                      <li>Coins can be gifted or used for shopping discounts</li>
                      <li>Wallet credits remain strictly non-withdrawable for purchases</li>
                    </ul>
                  </div>
                </>
              )}

              {earnModal === 'legal' && (
                <div className="space-y-2.5 text-xs text-slate-600 dark:text-[#9CA3AF]">
                  <p className="font-semibold text-slate-900 dark:text-white">
                    Buyoll Social Fintech Chama Marketplace ({legalTitle})
                  </p>
                  <p>
                    1. <b>Platform Facilitation</b>: Buyoll facilitates transparent member coordination, Chama group savings cycles, and store credit ledgers. Buyoll is not a banking institution and payments are made manually via M-Pesa Till 196853, Paybill 522533 (Account 4363), or direct Merchant Till 3463533.
                  </p>
                  <p>
                    2. <b>Non-Withdrawable Store Credit Policy</b>: All balances in user wallets are exclusively designated for marketplace item purchases and cannot be withdrawn as liquid cash.
                  </p>
                  <p>
                    3. <b>Peer Loans &amp; Speed Options</b>: 3rd-Party Chama group lenders operate under a fixed 3% facilitator rate. Members must fulfill their contribution obligations in full to maintain a high platform Financial CV.
                  </p>
                  <p>
                    4. <b>Merchant Ratings</b>: Members agree to submit verified star ratings and constructive feedback for shop owners upon group completion or interaction.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEarnModal(null)}
                className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg transition-colors"
              >
                Close
              </button>
              <a
                href="mailto:cityandcountyre@gmail.com?subject=Buyoll%20Inquiry"
                className="px-4 py-2 bg-[#0F5C3A] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg shadow-xs"
              >
                Contact Support
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

