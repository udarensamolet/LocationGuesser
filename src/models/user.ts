export interface AppUser {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
}

export const ANONYMOUS_USER: AppUser = {
  id: "anonymous",
  email: "",
  displayName: "Guest",
  isAdmin: false,
};
