import en from '../../messages/en.json';

// The portal's words. Its chrome is English only (owner's decision, 2026-11-26), so it reads
// these directly rather than through next-intl. Password-policy wording is the storefront's
// English, so a rule reads the same wherever a password is chosen.

export const SIGN_IN_ERRORS = {
  credentials: 'That email and password do not match a staff account.',
  blocked: 'This account cannot sign in. Ask a super admin to check it.',
  notStaff: 'This sign-in is for Barakah Bazaar staff. Customers sign in on the shop.',
  expired: 'Your sign-in timed out. Enter your password again.',
  emailInvalid: 'Enter a valid email address.',
  passwordMissing: 'Enter your password.',
  code: 'That code did not work. Check your authenticator app and try again.',
  codeFormat: 'Enter the 6-digit code from your authenticator app.',
  recoveryFormat: 'Enter one of your recovery codes.',
  locked: 'Too many incorrect codes. Try again in 15 minutes.',
  alreadyEnabled: 'Two-step sign-in is already set up for this account. Sign in with a code.',
  tooMany: 'Too many attempts. Wait a minute and try again.',
  unavailable: 'The server cannot be reached right now. Try again in a moment.',
} as const;

export type SignInError = keyof typeof SIGN_IN_ERRORS;

export const INVITATION_ERRORS = {
  invalid: 'This invitation link is not valid. Ask a super admin to send a new one.',
  expired: 'This invitation has expired. Ask a super admin to send it again.',
  accountExists: 'An account already exists for this invitation. Sign in instead.',
  nameMissing: 'Enter your full name.',
  passwordMismatch: en.auth.errors.passwordMismatch,
  passwordShort: en.auth.errors.passwordShort,
  passwordLong: en.auth.errors.passwordLong,
  passwordCommon: en.auth.errors.passwordCommon,
  passwordIdentity: en.auth.errors.passwordIdentity,
  passwordShopName: en.auth.errors.passwordShopName,
  passwordDistinct: en.auth.errors.passwordDistinct,
  passwordSequential: en.auth.errors.passwordSequential,
  passwordClasses: en.auth.errors.passwordClasses,
  formInvalid: 'Something in the form is not right. Check it and try again.',
  tooMany: SIGN_IN_ERRORS.tooMany,
  unavailable: SIGN_IN_ERRORS.unavailable,
} as const;

export type InvitationError = keyof typeof INVITATION_ERRORS;

/** The password rule, stated before anyone breaks it. */
export const PASSWORD_HINT = en.auth.fields.passwordHint;

/** The portal's own name, as tabs and the sidebar show it. */
export const PORTAL_NAME = 'Barakah Bazaar Admin';

export const SHELL_COPY = {
  portalLabel: 'Admin portal',
  homeLink: 'Barakah Bazaar admin, overview',
  nav: 'Admin sections',
  menu: 'Menu',
  signOut: 'Sign out',
  skipToContent: 'Skip to content',
} as const;

export const SIGN_IN_COPY = {
  title: 'Staff sign-in',
  intro: 'Sign in with your staff email. You will confirm it with your authenticator app.',
  email: 'Email address',
  password: 'Password',
  submit: 'Continue',
  pending: 'Checking…',
  forgot: 'Forgot your password?',
  shopLink: 'Shopping? Go to the shop',
} as const;

export const VERIFY_COPY = {
  title: 'Enter your code',
  intro: 'Open your authenticator app and enter the 6-digit code for Barakah Bazaar.',
  recoveryIntro: 'Enter one of the recovery codes you saved when you set up two-step sign-in.',
  code: '6-digit code',
  recoveryCode: 'Recovery code',
  useRecovery: 'Use a recovery code instead',
  useCode: 'Use the authenticator code instead',
  submit: 'Sign in',
  pending: 'Signing in…',
  back: 'Start again',
} as const;

export const SETUP_COPY = {
  title: 'Set up two-step sign-in',
  intro:
    'Staff accounts confirm every sign-in with a code from an authenticator app, such as Google Authenticator, Microsoft Authenticator or 1Password.',
  start: 'Show my setup code',
  starting: 'Preparing…',
  scan: 'Scan this code with your authenticator app.',
  qrLabel: 'QR code for your authenticator app',
  manual: 'Or type this key into the app:',
  code: 'Code from the app',
  confirm: 'Confirm',
  confirming: 'Confirming…',
  savedTitle: 'Save your recovery codes',
  savedIntro:
    'Each code signs you in once if you lose your phone. They are shown only now: store them somewhere safe, such as a password manager.',
  download: 'Download as a text file',
  downloadName: 'barakah-bazaar-recovery-codes.txt',
  acknowledge: 'I have saved these codes',
  continue: 'Continue to sign in',
  continueHint: 'Sign in again with your password, then a code from the app.',
  back: 'Start again',
} as const;

export const INVITATION_COPY = {
  title: 'Join the Barakah Bazaar team',
  intro: 'Choose your name and a password to finish setting up your staff account.',
  fullName: 'Full name',
  password: 'Password',
  confirm: 'Password again',
  submit: 'Create my account',
  pending: 'Creating…',
  missingToken: INVITATION_ERRORS.invalid,
  acceptedTitle: 'Your account is ready',
  acceptedIntro:
    'Sign in with your email and new password. You will then set up two-step sign-in with an authenticator app.',
  signIn: 'Go to sign-in',
} as const;

export const OVERVIEW_COPY = {
  title: 'Overview',
  greeting: 'Welcome back, {name}',
  account: 'Your account',
  email: 'Email',
  role: 'Role',
} as const;

export const NOT_FOUND_COPY = {
  title: 'Page not found',
  body: 'This page does not exist, or your role cannot open it.',
  back: 'Back to the overview',
} as const;
