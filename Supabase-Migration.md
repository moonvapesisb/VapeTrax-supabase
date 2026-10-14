# VapeTrax — Firebase to Supabase Migration

## Objective

Migrate the existing VapeTrax application completely from Firebase to Supabase.

The primary goal is to get the application working again as quickly as possible because the current Firebase setup is no longer functioning reliably.

This is **not** a security-hardening or architectural-rewrite task.

Priorities, in order:

1. Restore a fully functional VapeTrax application.
2. Replace Firebase with Supabase.
3. Preserve the existing UI, UX, features, and application behavior as much as possible.
4. Migrate existing Firebase data to Supabase.
5. Remove Firebase completely from the application after the Supabase migration is verified.
6. Keep the implementation simple and maintainable.
7. Do not introduce unnecessary backend infrastructure.

Security can be improved later. For now, prioritize functionality, speed, and stability.

---

# 1. First: Analyze the Existing Project

Before making changes, inspect the entire codebase.

Identify:

* Firebase initialization/configuration
* Firebase Authentication usage
* Firestore usage
* Firebase Storage usage, if any
* Firestore collections
* Document structures
* Firebase-related hooks
* Firebase-related utility/service files
* Firebase security rules
* Any Firebase Cloud Functions
* Any environment variables related to Firebase
* Any components/pages that directly call Firebase
* Any custom hooks such as `useFirestore`
* Any real-time Firestore listeners
* Any authentication/session logic
* Any role/permission logic
* Any image/file upload logic

Search the project for Firebase-related imports and APIs, including but not limited to:

```text
firebase
firebase/app
firebase/auth
firebase/firestore
firebase/storage

getDoc
getDocs
addDoc
setDoc
updateDoc
deleteDoc
onSnapshot

collection
doc
query
where
orderBy
limit

signIn
signOut
createUser
deleteUser
onAuthStateChanged

uploadBytes
getDownloadURL
deleteObject
```

Do not start blindly replacing imports.

First understand how the current application works.

---

# 2. Do NOT Rewrite the Frontend

The existing VapeTrax UI and functionality should remain intact.

Do NOT redesign the application.

Do NOT unnecessarily change:

* Layout
* Components
* Styling
* Navigation
* Forms
* Product pages
* Dashboard
* Existing workflows
* Existing business logic

Only modify code where necessary to replace Firebase functionality with Supabase functionality.

The migration should be as minimally invasive as reasonably possible.

---

# 3. Replace Firestore with Supabase PostgreSQL

Create a Supabase PostgreSQL schema that represents the existing VapeTrax data.

First inspect the existing Firestore collections and determine their actual structure.

Do not blindly create one PostgreSQL table for every Firestore collection if a better relational structure is obvious.

However, avoid unnecessary normalization or architectural complexity.

The schema should prioritize:

* Simple queries
* Easy CRUD operations
* Compatibility with the existing application
* Easy future expansion

Preserve existing data fields wherever practical so that the frontend requires minimal changes.

For example, if VapeTrax currently has product records containing fields such as:

```text
id
name
price
category
brand
stock
image
description
createdAt
...
```

create an appropriate `products` table containing equivalent information.

Do the same for all existing VapeTrax entities.

---

# 4. Migrate Existing Data

The existing Firebase/Firestore data is important.

Do not discard it.

Create a migration process to move the existing data from Firebase/Firestore into Supabase.

Before migration:

1. Inspect all relevant collections.
2. Determine their fields and relationships.
3. Export/read the existing records.
4. Transform them into the Supabase schema.
5. Insert them into Supabase.
6. Verify record counts and important records.

Do not delete Firebase data during this stage.

Firebase should initially remain available as a backup/reference source.

---

# 5. Replace Firebase Authentication

Replace Firebase Authentication with Supabase Auth.

The existing application should continue supporting the authentication flows it currently provides, such as:

* Login
* Logout
* Session persistence
* Current authenticated user
* User registration if currently supported
* Password reset if currently supported
* Protected pages/routes
* Existing user roles

Use the simplest Supabase Auth implementation that preserves the current behavior.

Do not introduce unnecessary custom authentication systems.

---

# 6. User Profiles / Roles

If the current application stores additional user information or roles outside Firebase Authentication, reproduce the necessary structure in Supabase.

For example:

```text
profiles
    id
    email
    name
    role
    created_at
```

If the current application has roles such as:

```text
admin
shop_owner
employee
customer
```

preserve the existing role behavior.

For now, do not build an elaborate RBAC framework.

The goal is simply to preserve the current application's functionality.

---

# 7. Replace Firebase Storage If Used

Inspect whether VapeTrax currently uses Firebase Storage.

If it does, migrate the required functionality to Supabase Storage.

For example:

```text
product-images/
```

or another appropriate bucket.

Preserve the existing image upload/display behavior.

Existing product images should remain accessible after migration.

If the application does NOT use Firebase Storage, do not add Supabase Storage unnecessarily.

---

# 8. Replace Existing Firebase Hooks / Data Layer

The current project may contain abstractions such as:

```text
useFirestore.ts
```

or other Firebase-specific hooks/services.

Replace these with Supabase equivalents.

Prefer a simple structure such as:

```text
src/
    lib/
        supabase.ts

    services/
        products.ts
        orders.ts
        users.ts
        ...

    hooks/
        useProducts.ts
        useOrders.ts
        ...
```

However, do not reorganize the entire project if that would create unnecessary work.

The main goal is to isolate Supabase access from UI components wherever practical.

For example:

```typescript
const { data, error } = await supabase
    .from("products")
    .select("*");
```

Use the Supabase client rather than Firebase SDK calls.

---

# 9. Preserve Existing Real-Time Behavior Where Needed

Inspect where the current application uses Firestore `onSnapshot()` or other real-time listeners.

If real-time updates are actually required by the existing UI, reproduce that behavior using Supabase Realtime.

Do not add realtime subscriptions everywhere.

Only migrate existing realtime functionality that the application genuinely depends on.

If a feature does not require real-time updates, use normal Supabase queries.

---

# 10. Business Logic

Do not create a new backend server unless the existing project clearly requires one.

For this migration:

```text
React frontend
        ↓
Supabase
        ↓
PostgreSQL / Auth / Storage
```

is sufficient.

Keep existing application/business logic in the frontend where it currently exists.

Do not introduce:

```text
Express
Node backend
Docker
Microservices
Separate API server
Complex Edge Functions
```

unless an existing feature genuinely cannot work without server-side execution.

This is intentionally a simple first version.

Security and backend architecture can be improved in a future phase.

---

# 11. Basic Supabase Configuration

Create a Supabase client using environment variables.

For example:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Use the appropriate variable names for the existing project's build system if it uses a different environment-variable convention.

Never hardcode credentials directly into source files.

Only use the public Supabase client key in the frontend.

Do NOT expose a Supabase service-role key in frontend code.

---

# 12. Keep Security Simple For Now

Do not spend excessive time implementing a sophisticated security model.

However, the database must still be usable from the frontend.

Configure basic Supabase policies/RLS only as necessary for the application to function.

Avoid creating a situation where the frontend cannot read/write its required data because of overly restrictive policies.

A more comprehensive security/RBAC implementation can be done later.

---

# 13. Remove Firebase Completely

This is an important requirement.

Once the Supabase implementation has been tested and confirmed to work:

REMOVE Firebase from the application.

Search the entire codebase again for:

```text
firebase
firestore
firebase/auth
firebase/storage
Firebase SDK
Firebase configuration
Firebase environment variables
```

Remove all obsolete Firebase code.

Remove Firebase dependencies from:

```text
package.json
```

if they are no longer required.

Remove obsolete Firebase configuration files.

Remove unused Firebase hooks/services.

Remove unused Firebase environment variables.

The final VapeTrax application should NOT initialize Firebase and should NOT make Firebase API requests.

The production application should communicate with Supabase instead.

---

# 14. Important: Firebase Backup

Do NOT immediately delete the Firebase project or its data.

The desired sequence is:

```text
Firebase
   │
   │ migrate
   ↓
Supabase
   │
   │ test thoroughly
   ↓
VapeTrax works
   │
   ↓
Remove Firebase from application
   │
   ↓
Keep Firebase project/data temporarily as backup
```

The application itself should be Firebase-free after the migration.

The Firebase project can remain untouched temporarily as a backup.

Only consider deleting/decommissioning Firebase later after the Supabase version has been stable and the data has been verified.

---

# 15. Verify No Firebase Traffic

After the migration:

1. Run the application.
2. Test authentication.
3. Test product CRUD.
4. Test all important existing workflows.
5. Test image uploads if applicable.
6. Test realtime functionality if applicable.
7. Open browser DevTools → Network.
8. Confirm that the application is communicating with Supabase.
9. Confirm that there are no Firebase/Firestore/Google Firebase requests originating from the application.
10. Search the compiled/build output if necessary to ensure Firebase code is no longer bundled.

The final architecture should look approximately like:

```text
                    VapeTrax
                       │
                       ↓
                React Frontend
                       │
          ┌────────────┼────────────┐
          ↓            ↓            ↓
       Supabase      Supabase     Supabase
        Auth        PostgreSQL    Storage
```

No Firebase dependency should remain.

---

# 16. Environment Variables

After migration, the frontend should only require the necessary Supabase environment variables.

For example:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Remove obsolete Firebase variables such as:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

if they exist and are no longer used.

---

# 17. Preserve Existing Data IDs Where Practical

When migrating records, preserve existing IDs where possible.

This is important because other records may reference them.

For example:

```text
product ID
order ID
customer ID
category ID
```

should remain consistent wherever practical.

Do not randomly generate new IDs if doing so would break existing relationships.

---

# 18. Error Handling

Replace Firebase-specific errors with appropriate Supabase error handling.

Do not leave errors silently ignored.

Existing user-facing error messages should remain understandable.

For example:

```typescript
if (error) {
    console.error(error);
    toast.error("Failed to load products");
}
```

Use the project's existing notification/error UI where possible.

---

# 19. Do Not Over-Engineer

This migration is intentionally a "working first" migration.

DO NOT:

* Rewrite the entire application
* Redesign the UI
* Build a separate backend
* Build microservices
* Add unnecessary abstraction layers
* Build an advanced permission system
* Add unnecessary realtime functionality
* Introduce unnecessary dependencies
* Optimize prematurely

Get VapeTrax working with Supabase first.

Future improvements can include:

* Better RLS
* Proper role-based access control
* Server-side business logic
* Edge Functions
* Audit logs
* Better validation
* More robust security
* Database indexes
* Better architecture
* Automated backups
* Production hardening

Those are future phases, not requirements for this migration.

---

# 20. Final Verification Checklist

Before declaring the migration complete, verify:

### Authentication

* [ ] Login works
* [ ] Logout works
* [ ] Sessions persist
* [ ] Protected routes work
* [ ] Existing roles still work

### Products

* [ ] Products load
* [ ] Products can be created
* [ ] Products can be edited
* [ ] Products can be deleted
* [ ] Product search/filter still works
* [ ] Product images work if applicable

### Other Data

* [ ] Existing customers/users are available
* [ ] Orders work
* [ ] Inventory works
* [ ] Categories work
* [ ] Any other existing VapeTrax functionality works

### Supabase

* [ ] PostgreSQL tables created
* [ ] Existing data migrated
* [ ] Supabase Auth configured
* [ ] Storage configured if required
* [ ] Required RLS policies configured
* [ ] Environment variables configured

### Firebase Removal

* [ ] No Firebase imports remain
* [ ] No Firestore imports remain
* [ ] No Firebase Auth imports remain
* [ ] No Firebase Storage imports remain
* [ ] Firebase dependencies removed
* [ ] Firebase environment variables removed
* [ ] Firebase initialization removed
* [ ] Firebase-specific hooks/services removed
* [ ] No Firebase API requests occur at runtime

### Final Build

* [ ] Development build works
* [ ] Production build works
* [ ] Production deployment works
* [ ] Browser Network tab shows Supabase requests instead of Firebase requests
* [ ] No major console errors

---

# Final Instruction

Before modifying files, analyze the existing VapeTrax implementation and produce a concise migration map showing:

```text
Firebase component
        ↓
Current VapeTrax usage
        ↓
Supabase replacement
        ↓
Files that need modification
```

Then implement the migration.

Do not stop at creating the Supabase schema. Complete the frontend integration and Firebase removal so that VapeTrax is actually usable with Supabase.

Keep the migration focused, practical, and minimal.
