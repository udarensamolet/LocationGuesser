import { AppUser } from "../../models/user";

declare global {
  namespace Express {
    interface Request {
      currentUser: AppUser;
    }
  }
}

export {};
