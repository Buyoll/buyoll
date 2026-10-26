import React, { useState } from 'react';
import { resolveImageUrl } from '../api.ts';
import {
  ExternalLink,
  Mail,
  ShieldCheck,
  Store,
  Bike,
  Share2,
  HelpCircle,
  MessageSquare,
  FileText,
  AlertCircle,
  X,
  CheckCircle2,
  Building,
} from 'lucide-react';

interface FooterProps {
  onNavigate?: (view: string, arg?: any) => void;
  onOpenHelp?: (tab?: string) => void;
  onOpenAuth?: () => void;
}

export const Footer: React.FC<FooterProps> = ({
  onNavigate,
  onOpenHelp,
  onOpenAuth,
}) => {
  const [partnerModal, setPartnerModal] = useState<string | null>(null);
  const [earnModal, setEarnModal] = useState<'rider' | 'merchant' | 'referral' | null>(null);

  const partners = [
    {
      name: 'Snaptube',
      desc: 'A crowdfunding, YouTube-like website.',
      tag: 'Crowdfunding & Video',
    },
    {
      name: 'Trender',
      desc: 'A microblogging and peer-to-peer gaming platform.',
      tag: 'Microblogging & P2P Gaming',
    },
    {
      name: 'Pesewa',
      desc: 'An M-Pesa-like fintech platform.',
      tag: 'Fintech & Mobile Money',
    },
    {
      name: 'ALO',
      desc: 'A WhatsApp-like betting platform.',
      tag: 'Social & Wagering',
    },
    {
      name: 'Airus',
      desc: 'A video-based short-stay rental platform.',
      tag: 'Hospitality & Stays',
    },
    {
      name: 'KiloKumi',
      desc: 'A social betting platform.',
      tag: 'Social Gaming',
    },
  ];

  return (
    <footer className="bg-white border-t border-slate-200 pt-12 pb-24 lg:pb-12 text-xs text-slate-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Main 4-Column Footer Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 mb-12">
          
          {/* Column 1: About Buyoll */}
          <div className="space-y-3">
            <div className="flex items-center gap-2.5">
              <img
                src={resolveImageUrl('buyoll_logo.png')}
                alt="Buyoll"
                className="h-8 w-auto object-contain"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
              <span className="font-extrabold text-slate-900 text-sm tracking-tight">
                Buyoll Fintech
              </span>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Buyoll connects shoppers, merchants, and members across Kenya through product discovery, configurable group-contribution Chama systems (speeds 10 down to 1-member Lipa Mdogomdogo), gradual payment arrangements, non-withdrawable shopping wallets, and merchant-sponsored promotional incentives.
            </p>

            <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-[11px]">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0E5A3C]" />
                <span>Transparent Manual Payments</span>
              </div>
              <p className="text-slate-500">
                Payments are made manually to <b>Platform Till: 196853</b> / <b>Paybill: 522533</b> (Acc: <b>4363</b>) or direct to <b>Merchant Till: 3463533</b>. Buyoll facilitates coordinated shopping and does not claim 100% escrow protection.
              </p>
            </div>
          </div>

          {/* Column 2: Make Money with Buyoll */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Make Money with Buyoll
            </h3>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  onClick={() => setEarnModal('rider')}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <Bike className="w-3.5 h-3.5 text-[#0E5A3C]" />
                  <span>Become a Rider / Delivery Partner</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (onNavigate) onNavigate('vendor-dashboard');
                    else setEarnModal('merchant');
                  }}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <Store className="w-3.5 h-3.5 text-[#0E5A3C]" />
                  <span>Become a Verified Merchant</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => setEarnModal('referral')}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <Share2 className="w-3.5 h-3.5 text-[#0E5A3C]" />
                  <span>Become a Referral Partner</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => {
                    if (onNavigate) onNavigate('lenders-dashboard');
                  }}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <Building className="w-3.5 h-3.5 text-[#0E5A3C]" />
                  <span>Serve as a 3rd-Party Group Lender (3% Fee)</span>
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Need Help? */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider">
              Need Help & Support?
            </h3>
            <ul className="space-y-2 text-xs">
              <li>
                <button
                  onClick={() => onOpenHelp && onOpenHelp('inquiry')}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <HelpCircle className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Community Questions & Feed</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => onOpenHelp && onOpenHelp('complaint')}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                  <span>Complaints & Dispute Feedback</span>
                </button>
              </li>
              <li>
                <button
                  onClick={() => onOpenHelp && onOpenHelp('general')}
                  className="hover:text-[#0E5A3C] transition-colors flex items-center gap-2 text-left text-slate-600 hover:font-semibold"
                >
                  <MessageSquare className="w-3.5 h-3.5 text-[#0E5A3C]" />
                  <span>Frequently Asked Questions (FAQ)</span>
                </button>
              </li>
            </ul>

            <div className="pt-2">
              <span className="text-[11px] text-slate-400 font-semibold block uppercase">Official Support Email</span>
              <a
                href="mailto:cityandcountyre@gmail.com"
                className="font-mono text-xs font-bold text-[#0E5A3C] hover:underline flex items-center gap-1.5 mt-0.5"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>cityandcountyre@gmail.com</span>
              </a>
            </div>
          </div>

          {/* Column 4: Buyoll Partners & Useful Links */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-900 text-xs uppercase tracking-wider flex items-center gap-1.5">
              <span>Buyoll Partners & Ecosystem</span>
            </h3>
            <p className="text-[11px] text-slate-500">
              Verified ecosystem partner platforms:
            </p>

            <div className="space-y-2">
              {partners.map((partner, idx) => (
                <div
                  key={idx}
                  className="p-2 bg-slate-50 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-xs">{partner.name}</span>
                    <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded font-medium">
                      {partner.tag}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {partner.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* Bottom Strip */}
        <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <div>
            © {new Date().getFullYear()} <b>Buyoll</b>. All rights reserved. Registered in Kenya.
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span>Platform Till: <b className="font-mono text-[#0E5A3C]">196853</b></span>
            <span>Paybill: <b className="font-mono text-[#0E5A3C]">522533</b> (Acc: <b>4363</b>)</span>
            <span>Merchant Till: <b className="font-mono text-slate-800">3463533</b></span>
          </div>
        </div>

      </div>

      {/* Make Money Onboarding Modal */}
      {earnModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4">
              <h3 className="font-bold text-slate-900 text-sm">
                {earnModal === 'rider' && '🚴 Rider & Delivery Partner Onboarding'}
                {earnModal === 'merchant' && '🏪 Buyoll Merchant Registration'}
                {earnModal === 'referral' && '🤝 Referral Partner Program'}
              </h3>
              <button
                onClick={() => setEarnModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-600 leading-relaxed mb-6">
              {earnModal === 'rider' && (
                <>
                  <p>
                    Dispatch matured Chama products directly from verified merchant shops to rotating buyers in your neighborhood.
                  </p>
                  <div className="p-3 bg-emerald-50 text-emerald-950 rounded-xl border border-emerald-200">
                    <span className="font-bold block mb-1">Rider Requirements:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Valid National ID & Driver/Rider License</li>
                      <li>Registered Motorbike or Bicycle with lockable carrier</li>
                      <li>Smart device with active M-Pesa phone number</li>
                    </ul>
                  </div>
                </>
              )}

              {earnModal === 'merchant' && (
                <>
                  <p>
                    Join over 500+ verified merchants offering appliances, furniture, and electronics with instant Chama group formation.
                  </p>
                  <div className="p-3 bg-emerald-50 text-emerald-950 rounded-xl border border-emerald-200">
                    <span className="font-bold block mb-1">Merchant Benefits:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Configurable 1 to 10-member speed groups</li>
                      <li>Dedicated Buyoll.ai sales assistant for every product</li>
                      <li>Direct payments to your Merchant Till: 3463533</li>
                    </ul>
                  </div>
                </>
              )}

              {earnModal === 'referral' && (
                <>
                  <p>
                    Earn 100 Reward Coins and store credits for every active Chama member you refer who completes their first installment.
                  </p>
                  <div className="p-3 bg-amber-50 text-amber-950 rounded-xl border border-amber-200">
                    <span className="font-bold block mb-1">Referral Terms:</span>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      <li>Share unique Chama invitation codes with friends & family</li>
                      <li>Coins can be gifted or redeemed for shopping discounts</li>
                      <li>Wallet credit is non-withdrawable and strictly for shopping</li>
                    </ul>
                  </div>
                </>
              )}

              <p className="text-[11px] text-slate-500">
                To complete your onboarding or submit credentials, contact our support desk directly at <b>cityandcountyre@gmail.com</b>.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEarnModal(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-lg"
              >
                Close
              </button>
              <a
                href="mailto:cityandcountyre@gmail.com?subject=Buyoll%20Partner%20Application"
                className="px-4 py-2 bg-[#0E5A3C] hover:bg-[#0b4830] text-white text-xs font-bold rounded-lg shadow-xs"
              >
                Email Support Team
              </a>
            </div>
          </div>
        </div>
      )}

    </footer>
  );
};
