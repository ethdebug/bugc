# BUG Language Examples

## Storage Access Patterns

The BUG language has specific rules about how storage variables can be accessed and modified. This directory contains examples demonstrating correct and incorrect patterns.

### Key Concept: Storage References vs Local Copies

In BUG, when you read a complex type (struct, array, or mapping) from storage into a local variable, you get a **copy** of the data, not a reference. This means:

- ✅ **Reading** from local copies works fine
- ❌ **Writing** to local copies does NOT update storage

### Correct Patterns

```bug
// Direct storage access - changes are persisted
accounts[user].balance = 1000;
votes[proposalId][0].amount = 100;
allowances[owner][spender] = 500;

// Reading into locals is fine
let currentBalance = accounts[user].balance;
let voteCount = votes[proposalId][0].amount;
```

### Incorrect Patterns

```bug
// ❌ WRONG: Changes to local copies don't persist
let userAccount = accounts[user];
userAccount.balance = 1000;  // This doesn't update storage!

// ❌ WRONG: Same issue with array elements
let firstVote = votes[proposalId][0];
firstVote.amount = 200;  // This doesn't update storage!
```

### Error Messages

With the improved storage access chain detection, attempting to modify storage through local variables now produces clear error messages:

```
❌ Error [IR_ERROR]: Cannot modify storage through local variable 'userAccount' of type Account. 
Direct storage access required for persistent changes.
```

### Files in this Directory

1. **storage-access-patterns.bug** - Demonstrates various correct storage access patterns
2. **storage-access-errors.bug** - Shows what happens when you try to modify storage through locals

### Why This Limitation?

This design choice makes storage access semantics explicit and prevents subtle bugs where developers might think they're modifying storage when they're actually just changing a local copy. It's similar to how Solidity handles storage references vs memory copies.

### Workaround

If you need to perform multiple operations on a storage struct, access each field directly:

```bug
// Instead of:
let account = accounts[user];
account.balance = account.balance + 100;
account.isActive = true;

// Do this:
accounts[user].balance = accounts[user].balance + 100;
accounts[user].isActive = true;
```