import React, { createContext, useCallback, useContext, useState } from "react";

const LoginModalContext = createContext({
  isOpen: false,
  options: { emailOnly: false, leaderboardParticipation: false },
  openLoginModal: () => {},
  closeLoginModal: () => {},
});

export function LoginModalProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState({ emailOnly: false, leaderboardParticipation: false });
  const openLoginModal = useCallback((nextOptions = {}) => {
    setOptions({
      emailOnly: nextOptions.emailOnly === true,
      leaderboardParticipation: nextOptions.leaderboardParticipation === true,
    });
    setIsOpen(true);
  }, []);
  const closeLoginModal = useCallback(() => {
    setIsOpen(false);
    setOptions({ emailOnly: false, leaderboardParticipation: false });
  }, []);

  return (
    <LoginModalContext.Provider value={{ isOpen, options, openLoginModal, closeLoginModal }}>
      {children}
    </LoginModalContext.Provider>
  );
}

export function useLoginModal() {
  return useContext(LoginModalContext);
}
