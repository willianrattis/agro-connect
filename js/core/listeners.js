import { currentAuthUid, currentUid } from "./state.js";

    // =====================================================
    // 8. Firestore listeners (animals + lots + transactions + settings)
    //    — lifecycle tied to auth
    // =====================================================
    // currentAuthUid = the authenticated Firebase user; currentUid = the
    // active account's owner uid (the data scope for all queries/writes).
    // They differ when the signed-in user is operating in a shared account.
    export function isSharedSession() {
      return currentAuthUid != null && currentUid != null && currentAuthUid !== currentUid;
    }
