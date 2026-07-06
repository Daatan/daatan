# Requirements Document: Prediction Commitment

> **Historical record, not current design.** The CU economy (balances, returns) specified
> below was subsequently abandoned; only the Brier/RS/Glicko-2/ELO scoring path is live
> today. See `design.md`'s banner for details.

## Introduction

This document specifies the requirements for the prediction commitment functionality in DAATAN, a reputation-based prediction platform. The commitment system allows users to stake Confidence Units (CU) on predictions, demonstrating their confidence in specific outcomes. When predictions resolve, users receive CU returns and Reputation Score (RS) adjustments based on the accuracy of their commitments.

The commitment system replaces the legacy "Vote" system with a more sophisticated mechanism that:
- Uses CU as a limited resource to prevent spam and encourage thoughtful predictions
- Tracks reputation over time through RS adjustments
- Maintains a complete transaction ledger for transparency
- Supports both binary (yes/no) and multiple choice predictions

## Glossary

- **User**: An authenticated person using the DAATAN platform
- **Prediction**: A testable claim with a defined resolution date and outcome criteria
- **Commitment**: A user's stake of CU on a specific prediction outcome
- **CU (Confidence Units)**: A limited resource users stake on predictions; users start with 100 CU
- **RS (Reputation Score)**: A measure of prediction accuracy over time; users start with 100 RS
- **Available_CU**: CU that a user can currently commit to new predictions
- **Locked_CU**: CU that is committed to active predictions and cannot be used
- **Binary_Prediction**: A prediction with two outcomes (will happen / won't happen)
- **Multiple_Choice_Prediction**: A prediction with 3-10 possible outcomes
- **Active_Prediction**: A prediction that is published and accepting commitments
- **Locked_Prediction**: A prediction that has received at least one commitment
- **Resolved_Prediction**: A prediction whose outcome has been determined
- **Transaction_Ledger**: A complete history of all CU movements for a user
- **Commitment_Form**: UI component for creating or updating a commitment
- **CU_Balance_Indicator**: UI component showing available and locked CU

## Requirements

### Requirement 1: Create Commitment

**User Story:** As a user, I want to commit CU to a prediction, so that I can demonstrate my confidence in a specific outcome and potentially earn reputation.

#### Acceptance Criteria

1. WHEN a user commits CU to a binary prediction, THE System SHALL require a binary choice (true/false) and a CU amount between 1 and the user's available CU
2. WHEN a user commits CU to a multiple choice prediction, THE System SHALL require selection of exactly one option and a CU amount between 1 and the user's available CU
3. WHEN a commitment is created, THE System SHALL atomically decrement the user's available CU, increment the user's locked CU, create a commitment record, and create a transaction ledger entry
4. WHEN a commitment is created, THE System SHALL record the user's current RS as a snapshot
5. IF a prediction receives its first commitment, THEN THE System SHALL set the prediction's lockedAt timestamp
6. WHEN a user attempts to commit to their own prediction, THE System SHALL reject the commitment
7. WHEN a user attempts to commit to a non-active prediction, THE System SHALL reject the commitment
8. WHEN a user attempts to commit more CU than they have available, THE System SHALL reject the commitment

### Requirement 2: View Commitment Status

**User Story:** As a user, I want to see my current commitment on a prediction, so that I can track what I've staked and on which outcome.

#### Acceptance Criteria

1. WHEN a user views a prediction they have committed to, THE System SHALL display their commitment amount, selected outcome, and the timestamp of commitment
2. WHEN a user views a prediction they have not committed to, THE System SHALL display a commitment form
3. WHEN displaying a commitment, THE System SHALL show whether the prediction is locked, active, or resolved
4. WHEN a prediction is resolved, THE System SHALL display the commitment result including CU returned and RS change

### Requirement 3: Update Commitment

**User Story:** As a user, I want to change my commitment before a prediction is locked or resolved, so that I can adjust my position based on new information.

#### Acceptance Criteria

1. WHEN a user updates a commitment on an active prediction, THE System SHALL allow changing the selected outcome and/or the CU amount
2. WHEN updating a commitment, THE System SHALL atomically adjust the user's available CU and locked CU to reflect the new commitment amount
3. WHEN updating a commitment, THE System SHALL create transaction ledger entries for the CU adjustment
4. WHEN a user attempts to update a commitment on a non-active prediction, THE System SHALL reject the update
5. WHEN updating a commitment, THE System SHALL update the RS snapshot to the current RS value

### Requirement 4: Remove Commitment

**User Story:** As a user, I want to withdraw my commitment before a prediction is resolved, so that I can reclaim my CU if I change my mind.

#### Acceptance Criteria

1. WHEN a user removes a commitment from an active prediction, THE System SHALL atomically delete the commitment record, increment the user's available CU, decrement the user's locked CU, and create a refund transaction ledger entry
2. WHEN a user attempts to remove a commitment from a non-active prediction, THE System SHALL reject the removal
3. WHEN a commitment is removed, THE System SHALL return all committed CU to the user's available balance

### Requirement 5: Display CU Balance

**User Story:** As a user, I want to see my available and locked CU balances, so that I know how much I can commit to new predictions.

#### Acceptance Criteria

1. WHEN a user views any page with commitment functionality, THE System SHALL display the user's current available CU and locked CU
2. WHEN a user's CU balance changes, THE System SHALL update the displayed balance immediately
3. WHEN displaying CU balance, THE System SHALL show the total CU as the sum of available and locked CU

### Requirement 6: Process Commitment Resolution

**User Story:** As a moderator, I want commitments to be automatically processed when I resolve a prediction, so that users receive their CU returns and RS adjustments.

#### Acceptance Criteria

1. WHEN a prediction is resolved as correct or wrong, THE System SHALL process each commitment to determine if it was correct based on the outcome
2. FOR ALL commitments on a resolved prediction, THE System SHALL return the committed CU to the user's available balance
3. FOR ALL correct commitments on a resolved prediction, THE System SHALL increase the user's RS
4. FOR ALL incorrect commitments on a resolved prediction, THE System SHALL decrease the user's RS
5. WHEN a prediction is resolved as void or unresolvable, THE System SHALL return all committed CU with no RS change
6. WHEN processing a commitment resolution, THE System SHALL atomically update the commitment record with cuReturned and rsChange, update the user's CU balances and RS, and create a transaction ledger entry
7. FOR ALL binary predictions resolved as correct, THE System SHALL consider commitments with binaryChoice=true as correct
8. FOR ALL binary predictions resolved as wrong, THE System SHALL consider commitments with binaryChoice=false as correct
9. FOR ALL multiple choice predictions, THE System SHALL consider commitments with optionId matching the correct option as correct

### Requirement 7: Transaction Ledger

**User Story:** As a user, I want to see a complete history of my CU transactions, so that I can understand how my balance has changed over time.

#### Acceptance Criteria

1. WHEN a commitment is created, THE System SHALL create a COMMITMENT_LOCK transaction with a negative amount
2. WHEN a commitment is resolved, THE System SHALL create a COMMITMENT_UNLOCK transaction with a positive amount
3. WHEN a commitment is removed, THE System SHALL create a REFUND transaction with a positive amount
4. WHEN a user signs up, THE System SHALL create an INITIAL_GRANT transaction with amount 100
5. FOR ALL transactions, THE System SHALL record the transaction type, amount, reference ID, note, and balance after transaction
6. WHEN a user views their transaction history, THE System SHALL display transactions in reverse chronological order

### Requirement 8: Commitment Validation

**User Story:** As a system, I want to validate all commitment operations, so that data integrity is maintained and business rules are enforced.

#### Acceptance Criteria

1. WHEN validating a commitment, THE System SHALL ensure the CU amount is an integer between 1 and 1000
2. WHEN validating a binary commitment, THE System SHALL ensure binaryChoice is a boolean value
3. WHEN validating a multiple choice commitment, THE System SHALL ensure optionId references a valid option for that prediction
4. WHEN validating any commitment operation, THE System SHALL ensure the user is authenticated
5. WHEN validating a commitment creation, THE System SHALL ensure the user has not already committed to that prediction
6. WHEN validating a commitment update or removal, THE System SHALL ensure the commitment exists and belongs to the requesting user

### Requirement 9: Commitment Display in Prediction List

**User Story:** As a user, I want to see commitment statistics on predictions in the list view, so that I can gauge community interest and participation.

#### Acceptance Criteria

1. WHEN displaying a prediction in a list, THE System SHALL show the total number of commitments
2. WHEN displaying a prediction in a list, THE System SHALL show the total CU committed across all users
3. WHEN a user views a prediction list, THE System SHALL indicate which predictions they have committed to

### Requirement 10: Commitment Atomicity

**User Story:** As a system, I want all commitment operations to be atomic, so that CU balances and ledger entries remain consistent even under concurrent access.

#### Acceptance Criteria

1. WHEN creating a commitment, THE System SHALL execute all database operations within a single transaction
2. WHEN updating a commitment, THE System SHALL execute all database operations within a single transaction
3. WHEN removing a commitment, THE System SHALL execute all database operations within a single transaction
4. WHEN resolving commitments, THE System SHALL process all commitments for a prediction within a single transaction
5. IF any operation within a commitment transaction fails, THEN THE System SHALL roll back all changes and return an error
