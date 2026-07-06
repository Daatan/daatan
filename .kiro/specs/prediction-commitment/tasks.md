# Implementation Plan: Prediction Commitment

> **Historical record, not a live plan.** This is the original implementation plan for the
> CU-staking economy, later abandoned. See `design.md`'s banner for details.

## Overview

This implementation plan builds upon existing commitment infrastructure (database models, basic create/delete endpoints) to complete the prediction commitment feature. The approach is incremental: first enhance API endpoints, then build UI components, then add property-based tests for correctness validation.

## Tasks

- [ ] 1. Enhance validation schemas and add update endpoint
  - [x] 1.1 Add updateCommitmentSchema to src/lib/validations/prediction.ts
    - Create schema with optional cuCommitted, binaryChoice, optionId fields
    - Add refinement to ensure at least one field is provided
    - Add refinement to validate outcome changes
    - Export UpdateCommitmentInput type
    - _Requirements: 3.1, 8.1, 8.2, 8.3_
  
  - [x] 1.2 Add listCommitmentsQuerySchema to src/lib/validations/prediction.ts
    - Create schema with optional predictionId, status, page, limit
    - Set defaults: page=1, limit=20
    - Add validation: limit max 100
    - Export ListCommitmentsQuery type
    - _Requirements: 7.6_
  
  - [x] 1.3 Implement PATCH /api/predictions/[id]/commit endpoint
    - Validate request with updateCommitmentSchema
    - Check authentication and authorization
    - Verify prediction is ACTIVE
    - Calculate CU delta (new amount - old amount)
    - Implement atomic transaction: update commitment, adjust user CU balances, create ledger entries
    - Update rsSnapshot to current RS
    - Return updated commitment with user and option data
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.6_
  
  - [ ]* 1.4 Write property test for commitment update atomicity
    - **Property 7: Commitment Update Atomicity**
    - **Validates: Requirements 3.2, 3.3, 10.2**
    - Generate random commitment updates with CU changes
    - Verify cuAvailable and cuLocked adjust by delta
    - Verify transaction ledger entries created
    - Verify all operations succeed or all fail together

- [ ] 2. Implement user commitments list endpoint
  - [x] 2.1 Create GET /api/commitments endpoint
    - Validate query parameters with listCommitmentsQuerySchema
    - Check authentication
    - Build where clause from filters (predictionId, status)
    - Query commitments with pagination
    - Include prediction, option, and user data
    - Calculate total count for pagination
    - Return commitments array and pagination metadata
    - _Requirements: 7.6_
  
  - [ ]* 2.2 Write property test for transaction ordering
    - **Property 16: Transaction Ordering**
    - **Validates: Requirements 7.6**
    - Generate random transaction history
    - Query user's transactions
    - Verify returned in reverse chronological order

- [ ] 3. Build CU Balance Indicator component
  - [x] 3.1 Create src/components/predictions/CUBalanceIndicator.tsx
    - Define CUBalanceIndicatorProps interface
    - Display available CU prominently
    - Display locked CU as secondary info
    - Show total CU if showDetails prop is true
    - Add visual indicator (progress bar or icon)
    - Apply color coding: green (>50), yellow (10-50), red (<10)
    - Style with Tailwind CSS
    - _Requirements: 5.1, 5.3_
  
  - [ ]* 3.2 Write unit tests for CUBalanceIndicator
    - Test rendering with various CU values
    - Test color coding thresholds
    - Test showDetails prop
    - Test total CU calculation

- [ ] 4. Build Commitment Display component
  - [x] 4.1 Create src/components/predictions/CommitmentDisplay.tsx
    - Define CommitmentDisplayProps interface
    - Display committed CU amount
    - Display selected outcome (option text or binary choice label)
    - Display commitment timestamp
    - Show Edit button if prediction is ACTIVE
    - Show Remove button if prediction is ACTIVE
    - Display resolution results if resolved (cuReturned, rsChange with +/- indicators)
    - Style with Tailwind CSS (green for gains, red for losses)
    - _Requirements: 2.1, 2.3, 2.4_
  
  - [x] 4.2 Implement Edit button handler
    - Call onEdit callback prop
    - Opens CommitmentForm in update mode
    - _Requirements: 3.1_
  
  - [x] 4.3 Implement Remove button handler
    - Show confirmation dialog
    - Call DELETE /api/predictions/[id]/commit
    - Handle loading state
    - Handle errors
    - Call onRemove callback on success
    - _Requirements: 4.1_
  
  - [ ]* 4.4 Write property test for commitment display completeness
    - **Property 19: Commitment Display Completeness**
    - **Validates: Requirements 2.1, 2.3, 2.4, 5.1**
    - Generate random commitments (active and resolved)
    - Render CommitmentDisplay component
    - Verify output contains all required fields

- [ ] 5. Build Commitment Form component
  - [x] 5.1 Create src/components/predictions/CommitmentForm.tsx
    - Define CommitmentFormProps interface
    - Initialize state: cuAmount, selectedOutcome, isSubmitting, error
    - For binary predictions: render "Will Happen" / "Won't Happen" toggle
    - For multiple choice: render radio buttons for each option
    - Render CU amount input/slider (1 to userCuAvailable)
    - Disable submit if no outcome selected or CU < 1
    - Show real-time validation feedback
    - Style with Tailwind CSS
    - _Requirements: 1.1, 1.2, 8.1_
  
  - [x] 5.2 Implement form submission handler
    - Determine if creating new or updating existing commitment
    - Call POST /api/predictions/[id]/commit for new
    - Call PATCH /api/predictions/[id]/commit for update
    - Set isSubmitting state during request
    - Handle API errors and display error messages
    - Call onSuccess callback with result
    - _Requirements: 1.3, 3.1_
  
  - [ ]* 5.3 Write unit tests for CommitmentForm
    - Test rendering for binary predictions
    - Test rendering for multiple choice predictions
    - Test form validation
    - Test submission (create and update modes)
    - Test error handling

- [x] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Write property tests for commitment creation
  - [ ]* 7.1 Write property test for binary commitment validation
    - **Property 1: Binary Commitment Validation**
    - **Validates: Requirements 1.1, 8.1, 8.2**
    - Generate random binary predictions and commitment requests
    - Verify valid requests (with binaryChoice and valid CU) are accepted
    - Verify invalid requests are rejected
  
  - [ ]* 7.2 Write property test for multiple choice commitment validation
    - **Property 2: Multiple Choice Commitment Validation**
    - **Validates: Requirements 1.2, 8.1, 8.3**
    - Generate random MC predictions and commitment requests
    - Verify valid requests (with valid optionId and CU) are accepted
    - Verify invalid requests are rejected
  
  - [ ]* 7.3 Write property test for commitment creation atomicity
    - **Property 3: Commitment Creation Atomicity**
    - **Validates: Requirements 1.3, 7.1, 10.1**
    - Generate random valid commitments
    - Verify all four operations succeed together
    - Verify cuAvailable decreases, cuLocked increases, commitment created, transaction created
  
  - [ ]* 7.4 Write property test for RS snapshot
    - **Property 4: RS Snapshot on Commitment**
    - **Validates: Requirements 1.4, 3.5**
    - Generate random commitments
    - Verify rsSnapshot equals user's current RS
  
  - [ ]* 7.5 Write property test for first commitment locking
    - **Property 5: First Commitment Locks Prediction**
    - **Validates: Requirements 1.5**
    - Generate predictions with 0 and >0 commitments
    - Verify first commitment sets lockedAt
    - Verify subsequent commitments don't change lockedAt
  
  - [ ]* 7.6 Write property test for commitment authorization
    - **Property 6: Commitment Authorization Rules**
    - **Validates: Requirements 1.6, 1.7, 1.8, 8.4**
    - Generate invalid commitment scenarios (own prediction, non-active, insufficient CU)
    - Verify all are rejected with appropriate errors

- [ ] 8. Write property tests for commitment updates and removal
  - [ ]* 8.1 Write property test for update authorization
    - **Property 8: Update Authorization**
    - **Validates: Requirements 3.4, 4.2, 8.6**
    - Generate invalid update/removal scenarios
    - Verify rejected appropriately
  
  - [ ]* 8.2 Write property test for commitment removal atomicity
    - **Property 9: Commitment Removal Atomicity**
    - **Validates: Requirements 4.1, 4.3, 7.3, 10.3**
    - Generate random commitment removals
    - Verify all four operations succeed together
    - Verify commitment deleted, CU refunded, transaction created
  
  - [ ]* 8.3 Write property test for CU balance invariant
    - **Property 10: CU Balance Invariant**
    - **Validates: Requirements 5.3, 7.5**
    - Generate random sequences of commitment operations
    - Verify cuAvailable + cuLocked = sum of transaction amounts

- [ ] 9. Write property tests for resolution
  - [ ]* 9.1 Write property test for resolution correctness determination
    - **Property 11: Resolution Correctness Determination**
    - **Validates: Requirements 6.1, 6.7, 6.8, 6.9**
    - Generate random resolved predictions (binary and MC)
    - Verify correct commitments identified based on outcome
  
  - [ ]* 9.2 Write property test for resolution CU return
    - **Property 12: Resolution CU Return**
    - **Validates: Requirements 6.2**
    - Generate random resolved predictions
    - Verify all commitments get CU returned
  
  - [ ]* 9.3 Write property test for resolution RS adjustment
    - **Property 13: Resolution RS Adjustment**
    - **Validates: Requirements 6.3, 6.4, 6.5**
    - Generate random resolved predictions (correct, wrong, void)
    - Verify RS increases for correct, decreases for incorrect, unchanged for void
  
  - [ ]* 9.4 Write property test for resolution atomicity
    - **Property 14: Resolution Atomicity**
    - **Validates: Requirements 6.6, 10.4, 10.5**
    - Generate random commitment resolutions
    - Verify all operations succeed together or all fail

- [ ] 10. Write property tests for ledger and statistics
  - [ ]* 10.1 Write property test for transaction ledger completeness
    - **Property 15: Transaction Ledger Completeness**
    - **Validates: Requirements 7.4, 7.5**
    - Generate random commitment lifecycle operations
    - Verify all expected transactions exist with correct fields
  
  - [ ]* 10.2 Write property test for duplicate prevention
    - **Property 17: Duplicate Commitment Prevention**
    - **Validates: Requirements 8.5**
    - Attempt to create duplicate commitments
    - Verify second attempt is rejected
  
  - [ ]* 10.3 Write property test for prediction list statistics
    - **Property 18: Prediction List Statistics**
    - **Validates: Requirements 9.1, 9.2**
    - Generate predictions with random commitments
    - Verify displayed counts and totals match actual data

- [ ] 11. Integrate components into prediction pages
  - [x] 11.1 Update prediction detail page to use commitment components
    - Import CommitmentForm, CommitmentDisplay, CUBalanceIndicator
    - Fetch user's commitment for the prediction
    - Show CUBalanceIndicator in header/sidebar
    - Show CommitmentDisplay if user has committed
    - Show CommitmentForm if user hasn't committed or in edit mode
    - Handle commitment creation/update/removal callbacks
    - Refresh prediction data after commitment changes
    - _Requirements: 2.1, 2.2, 5.1_
  
  - [x] 11.2 Update prediction list page to show commitment indicators
    - Display commitment count and total CU for each prediction
    - Add visual indicator for predictions user has committed to
    - _Requirements: 9.1, 9.2, 9.3_
  
  - [ ]* 11.3 Write integration tests for prediction pages
    - Test commitment workflow end-to-end
    - Test UI updates after commitment operations
    - Test error handling and display

- [x] 12. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property-based and unit tests
- Each property test references specific design document properties
- Property tests should run minimum 100 iterations
- Existing endpoints (POST /commit, DELETE /commit) are already implemented
- Focus on completing PATCH /commit, GET /commitments, and UI components
- All API operations use Prisma transactions for atomicity
- UI components use Tailwind CSS for styling
- Follow Next.js 14 App Router patterns (Server Components where possible)
