// components/auth/UnauthorizedPage.js
//
// Where a person lands when their role does not reach the page they asked
// for. It is a dead end by definition, so the whole job is telling them who
// they are signed in as and giving them a way out that works.
import React from 'react';
import { ShieldAlert } from 'lucide-react';
import roleLanding from '../../utils/roleLanding';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import AuthService from '../../services/AuthService';
import LogoutButton from '../shared/LogoutButton';
import { Button, Pill } from '../../design';

const UnauthorizedPage = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const currentUser = AuthService.getCurrentUser();

  const requiredRoles = location.state?.requiredRoles || [];

  const handleGoBack = () => navigate(-1);

  const getLandingPage = () => {
    if (!currentUser) return '/';
    return roleLanding(currentUser.role);
  };

  return (
    <div className="cq min-h-screen bg-cq-cream flex items-center justify-center p-4">
      <div className="bg-cq-milk p-8 rounded-cq-lg shadow-cq-card max-w-md w-full">
        <div className="text-center mb-6">
          <div className="bg-cq-alert-wash text-cq-alert rounded-full inline-flex
                          items-center justify-center w-16 h-16 mb-4">
            <ShieldAlert size={32} strokeWidth={2.5} />
          </div>
          <h1 className="text-2xl font-bold text-cq-roast">That page is not yours</h1>
          <p className="text-cq-ink-2 mt-2">
            Your sign-in does not reach this part of the app.
          </p>
        </div>

        {requiredRoles.length > 0 && (
          <div className="bg-cq-wash p-4 rounded-cq-md mb-6">
            <p className="text-xs font-extrabold uppercase tracking-wider text-cq-ink-3 mb-2">
              It needs one of these
            </p>
            <div className="flex flex-wrap gap-2">
              {requiredRoles.map(role => <Pill key={role}>{role}</Pill>)}
            </div>
          </div>
        )}

        {currentUser && (
          <p className="text-center text-cq-ink-2 mb-6">
            Signed in as <strong className="text-cq-roast">{currentUser.username}</strong>
            {' — '}{currentUser.role}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <Link to={getLandingPage()} className="contents">
            <Button variant="primary" block>Go to your home screen</Button>
          </Link>
          <Button variant="secondary" block onClick={handleGoBack}>Go back</Button>
          <LogoutButton
            showIcon
            showText
            className="justify-center py-2 px-4 w-full"
            confirmLogout={false}
          />
        </div>
      </div>
    </div>
  );
};

export default UnauthorizedPage;
