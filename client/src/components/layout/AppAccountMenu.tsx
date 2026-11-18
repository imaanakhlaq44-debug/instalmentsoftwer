import React from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, LogOut } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { LanguageToggle } from '../../i18n/LanguageContext.js';

/**
 * Inside the shop app there is no website navbar, so the account controls it
 * holds (who is signed in, language, password, sign out) live at the top of
 * the app's settings sheet instead.
 */
export const AppAccountMenu: React.FC<{ close: () => void }> = ({ close }) => {
  const { user, dealer, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="mb-5">
      <h3 className="eyebrow mb-2">Account</h3>
      <div className="surface divide-y divide-paper-300 overflow-hidden">
        {user && (
          <div className="px-4 py-3">
            <p className="text-body font-bold text-ink-900">{user.name}</p>
            {dealer?.name && <p className="text-caption text-ink-500">{dealer.name}</p>}
          </div>
        )}
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-3">
          <span className="text-body font-bold">Language</span>
          <LanguageToggle />
        </div>
        <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-body font-bold hover:bg-paper-200"
          onClick={() => { close(); navigate('/change-password'); }}>
          <KeyRound className="h-5 w-5" aria-hidden="true" />Change password
        </button>
        <button type="button" className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left text-body font-bold text-critical-600 hover:bg-critical-50"
          onClick={() => { close(); logout(); }}>
          <LogOut className="h-5 w-5" aria-hidden="true" />Sign out
        </button>
      </div>
    </div>
  );
};
