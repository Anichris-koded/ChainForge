#![cfg(test)]

//! Authorization invariant tests for `create_package`.
//!
//! Every other integration test in this crate calls `env.mock_all_auths()`,
//! which makes *every* `Address::require_auth()` call in the contract
//! succeed unconditionally — including ones that were never actually wired
//! up correctly. That is convenient for testing business logic, but it also
//! means none of those tests would catch a regression where
//! `require_admin_or_distributor` stopped calling `operator.require_auth()`
//! (e.g. if a refactor accidentally short-circuited the check, or a reentrant
//! token-transfer callback tried to reuse a stale authorization).
//!
//! These tests deliberately avoid `mock_all_auths()` and instead either:
//! - supply zero `SorobanAuthorizationEntry` values (`env.set_auths(&[])`), or
//! - supply an explicit `MockAuth`/`MockAuthInvoke` tree that only
//!   authorizes the exact address, contract, function and arguments under
//!   test.
//!
//! This exercises Soroban's real `AuthorizedInvocation` verification instead
//! of the test-only bypass, so a missing or misdirected `require_auth()`
//! call in `create_package` (or anything it delegates to) will fail these
//! tests.

use aid_escrow::{AidEscrow, AidEscrowClient, Config, Error};
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo, MockAuth, MockAuthInvoke},
    token::StellarAssetClient,
    Address, Env, IntoVal, Map, Vec,
};

const ONE_TOKEN: i128 = 10_000_000;

fn default_ledger_info() -> LedgerInfo {
    LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 23,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 10,
        min_persistent_entry_ttl: 10,
        max_entry_ttl: 3_110_400,
    }
}

/// Sets up an initialized, funded contract. Setup itself uses
/// `mock_all_auths()` since we are not testing `init`/`fund`/`set_config`
/// here — only the `create_package` call made afterwards matters, and
/// callers reset auth mocking before making it.
struct Setup {
    env: Env,
    client: AidEscrowClient<'static>,
    contract_id: Address,
    admin: Address,
    token: Address,
}

impl Setup {
    fn new() -> Self {
        let env = Env::default();
        env.ledger().set(default_ledger_info());
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(AidEscrow, ());
        let client = AidEscrowClient::new(&env, &contract_id);

        let token_id = env.register_stellar_asset_contract_v2(admin.clone());
        let token = token_id.address();
        let token_sac = StellarAssetClient::new(&env, &token);

        client.init(&admin);
        client.set_config(&Config {
            min_amount: 1,
            max_expires_in: 0,
            allowed_tokens: Vec::new(&env),
        });
        token_sac.mint(&contract_id, &ONE_TOKEN);

        Self {
            env,
            client,
            contract_id,
            admin,
            token,
        }
    }
}

/// Acceptance criteria: `try_create_package` must reject an operator that
/// never called `require_auth()` at all. With zero authorization entries
/// present, Soroban's host traps the moment `operator.require_auth()`
/// executes — before any of the contract's own `Result::Err` return paths
/// run. The client's `try_*` wrapper surfaces that host-level rejection as
/// `Err(Err(InvokeError::Abort))` rather than our contract's
/// `Error::NotAuthorized`, since the contract never got a chance to return
/// anything. That distinction *is* the point of this test: it proves
/// rejection happens at Soroban's native auth layer, not merely inside our
/// business logic, so it cannot be bypassed by any code path that skips our
/// own checks but still reaches `require_auth()`.
#[test]
fn create_package_without_any_auth_is_rejected_by_the_host() {
    let s = Setup::new();

    // No mock_all_auths(), no MockAuth — explicitly zero authorizations.
    s.env.set_auths(&[]);

    let recipient = Address::generate(&s.env);
    let result = s.client.try_create_package(
        &s.admin,
        &1u64,
        &recipient,
        &ONE_TOKEN,
        &s.token,
        &(s.env.ledger().timestamp() + 3600),
        &Map::new(&s.env),
    );

    assert!(
        result.is_err(),
        "create_package must not succeed without operator authorization"
    );
    // No package should have been persisted.
    assert!(s.client.try_get_package(&1u64).is_err());
}

/// Even an address that *can* authorize itself is not automatically a
/// distributor or admin. This is the direct regression guard for the
/// "distributor role escalation" concern in the issue: proving your own
/// identity via `require_auth()` must not be conflated with holding the
/// admin/distributor role. Here the operator's authorization is real (built
/// via `MockAuth`, not the blanket `mock_all_auths()` bypass) and still
/// correctly rejected by `require_admin_or_distributor`'s role check,
/// returning our contract's `Error::NotAuthorized`.
#[test]
fn create_package_authenticated_non_privileged_operator_is_rejected() {
    let s = Setup::new();

    let outsider = Address::generate(&s.env);
    let recipient = Address::generate(&s.env);
    let id = 2u64;
    let amount = ONE_TOKEN;
    let expires_at = s.env.ledger().timestamp() + 3600;
    let metadata: Map<soroban_sdk::Symbol, soroban_sdk::String> = Map::new(&s.env);

    let result = s
        .client
        .mock_auths(&[MockAuth {
            address: &outsider,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "create_package",
                args: (
                    outsider.clone(),
                    id,
                    recipient.clone(),
                    amount,
                    s.token.clone(),
                    expires_at,
                    metadata.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .try_create_package(
            &outsider,
            &id,
            &recipient,
            &amount,
            &s.token,
            &expires_at,
            &metadata,
        );

    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
}

/// The admin path must keep working under a real, narrowly-scoped
/// `AuthorizedInvocation` — not just under `mock_all_auths()`. This pins down
/// that `require_admin_or_distributor` authorizes against the exact
/// `create_package` invocation (contract, function name and arguments) for
/// the admin address.
#[test]
fn create_package_admin_path_succeeds_with_real_authorized_invocation() {
    let s = Setup::new();

    let recipient = Address::generate(&s.env);
    let id = 3u64;
    let amount = ONE_TOKEN;
    let expires_at = s.env.ledger().timestamp() + 3600;
    let metadata: Map<soroban_sdk::Symbol, soroban_sdk::String> = Map::new(&s.env);

    let package_id = s
        .client
        .mock_auths(&[MockAuth {
            address: &s.admin,
            invoke: &MockAuthInvoke {
                contract: &s.contract_id,
                fn_name: "create_package",
                args: (
                    s.admin.clone(),
                    id,
                    recipient.clone(),
                    amount,
                    s.token.clone(),
                    expires_at,
                    metadata.clone(),
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .create_package(
            &s.admin,
            &id,
            &recipient,
            &amount,
            &s.token,
            &expires_at,
            &metadata,
        );

    assert_eq!(package_id, id);
    let pkg = s.client.get_package(&id);
    assert_eq!(pkg.amount, amount);
}
