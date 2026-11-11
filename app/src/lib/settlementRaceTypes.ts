/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/settlement_race.json`.
 *
 * Committed copy: `target/` is gitignored, so the app build regenerates this
 * file from `anchor build` output. Refresh both this file and
 * `settlement_race.json` together after any program change.
 */
export type SettlementRace = {
  "address": "4watv8QyNJ5zjLkh4QYpUKDuFf24SAKzSRLAPMxoWNB3",
  "metadata": {
    "name": "settlementRace",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Tokenized USD/CAD exchange comparing sequential pay-first settlement against atomic delivery-versus-payment on Solana devnet"
  },
  "instructions": [
    {
      "name": "acknowledge",
      "docs": [
        "A party acknowledges the ticket; both acknowledgements reach `Ack`."
      ],
      "discriminator": [
        209,
        182,
        197,
        45,
        97,
        93,
        210,
        58
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "advanceClock",
      "docs": [
        "Monotonic demo control that moves the virtual clock forward.",
        "Driver only, and capped a full gap window below `i64::MAX`."
      ],
      "discriminator": [
        52,
        57,
        147,
        111,
        56,
        227,
        33,
        127
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "toVirtualMs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "anchorChainHead",
      "docs": [
        "Anchors the provenance chain head once the scenario is terminal."
      ],
      "discriminator": [
        73,
        113,
        28,
        132,
        191,
        58,
        12,
        17
      ],
      "accounts": [
        {
          "name": "scenario"
        },
        {
          "name": "driver",
          "writable": true,
          "signer": true
        },
        {
          "name": "chainHead",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  104,
                  97,
                  105,
                  110,
                  95,
                  104,
                  101,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "finalHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "eventCount",
          "type": "u64"
        },
        {
          "name": "anchoredVirtualMs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "declareDefault",
      "docs": [
        "Declares default after the gap expires with leg 2 unpaid and",
        "reclaims the CAD escrow remainder for party B. Driver only."
      ],
      "discriminator": [
        111,
        69,
        178,
        74,
        121,
        205,
        118,
        251
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vaultCad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "partyBAta",
          "docs": [
            "Party B's CAD ATA, the reclamation destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "fundLeg",
      "docs": [
        "A party escrows funds for its leg while the status is `Ack`."
      ],
      "discriminator": [
        248,
        220,
        218,
        94,
        70,
        89,
        32,
        10
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "partyAta",
          "docs": [
            "The funding party's ATA for the leg's mint."
          ],
          "writable": true
        },
        {
          "name": "vaultUsd",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  117,
                  115,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "vaultCad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "leg",
          "type": {
            "defined": {
              "name": "leg"
            }
          }
        },
        {
          "name": "amountCents",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeScenario",
      "docs": [
        "Creates the Scenario PDA and both escrow vaults for one race lane.",
        "The counterparties arrive as remaining accounts, in order",
        "`[party_a, party_b]`."
      ],
      "discriminator": [
        7,
        203,
        128,
        202,
        132,
        170,
        4,
        82
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  99,
                  101,
                  110,
                  97,
                  114,
                  105,
                  111
                ]
              },
              {
                "kind": "account",
                "path": "driver"
              },
              {
                "kind": "arg",
                "path": "scenarioId"
              }
            ]
          }
        },
        {
          "name": "driver",
          "writable": true,
          "signer": true
        },
        {
          "name": "usdMint"
        },
        {
          "name": "cadMint"
        },
        {
          "name": "vaultUsd",
          "docs": [
            "USD escrow vault, an SPL token account that is its own authority."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  117,
                  115,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "vaultCad",
          "docs": [
            "CAD escrow vault, an SPL token account that is its own authority."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "scenarioId",
          "type": "u64"
        },
        {
          "name": "ticketHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "leg1Cents",
          "type": "u64"
        },
        {
          "name": "leg2Cents",
          "type": "u64"
        },
        {
          "name": "gapMs",
          "type": "i64"
        }
      ]
    },
    {
      "name": "markFailed",
      "docs": [
        "Marks `Paying` as `Failed`, used after a reverted atomic attempt."
      ],
      "discriminator": [
        58,
        234,
        53,
        63,
        84,
        15,
        46,
        105
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "reason",
          "type": "string"
        }
      ]
    },
    {
      "name": "releaseLeg1",
      "docs": [
        "Sequential pay-first release of the USD leg to party B. Driver only."
      ],
      "discriminator": [
        135,
        10,
        114,
        255,
        112,
        121,
        239,
        26
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vaultUsd",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  117,
                  115,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "partyBAta",
          "docs": [
            "Party B's USD ATA, the leg 1 destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "releaseLeg2",
      "docs": [
        "Full sequential release of the CAD leg, settles the scenario.",
        "Capped at funded minus paid; party B signs."
      ],
      "discriminator": [
        96,
        128,
        150,
        19,
        51,
        134,
        58,
        153
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vaultCad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "partyAAta",
          "docs": [
            "Party A's CAD ATA, the leg 2 destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "releaseLeg2Partial",
      "docs": [
        "Partial sequential release of the CAD leg, records paid progress.",
        "Capped at funded minus paid as well as the remaining notional."
      ],
      "discriminator": [
        50,
        160,
        168,
        216,
        85,
        81,
        13,
        164
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vaultCad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "partyAAta",
          "docs": [
            "Party A's CAD ATA, the leg 2 destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amountCents",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleAtomic",
      "docs": [
        "Atomic delivery versus payment: both legs in one instruction.",
        "Driver only."
      ],
      "discriminator": [
        125,
        171,
        110,
        28,
        59,
        108,
        127,
        23
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        },
        {
          "name": "vaultUsd",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  117,
                  115,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "vaultCad",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  99,
                  97,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "scenario"
              }
            ]
          }
        },
        {
          "name": "partyBAta",
          "docs": [
            "Party B's USD ATA, the leg 1 destination."
          ],
          "writable": true
        },
        {
          "name": "partyAAta",
          "docs": [
            "Party A's CAD ATA, the leg 2 destination."
          ],
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "startRace",
      "docs": [
        "Opens the race: sets the route, moves to `Paying`, and stamps the",
        "race start with the current virtual time. Driver only."
      ],
      "discriminator": [
        167,
        209,
        181,
        53,
        90,
        108,
        220,
        120
      ],
      "accounts": [
        {
          "name": "scenario",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": [
        {
          "name": "path",
          "type": {
            "defined": {
              "name": "settlementPath"
            }
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "chainHead",
      "discriminator": [
        47,
        218,
        37,
        20,
        39,
        61,
        70,
        190
      ]
    },
    {
      "name": "scenario",
      "discriminator": [
        235,
        34,
        154,
        51,
        145,
        251,
        207,
        158
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "insufficientEscrow",
      "msg": "Insufficient escrow balance for this operation"
    },
    {
      "code": 6001,
      "name": "notParty",
      "msg": "Signer is not an authorized party for this scenario"
    },
    {
      "code": 6002,
      "name": "badState",
      "msg": "Instruction not allowed in the current state"
    },
    {
      "code": 6003,
      "name": "gapNotExpired",
      "msg": "The gap window has not expired"
    },
    {
      "code": 6004,
      "name": "clockRegression",
      "msg": "Clock regression detected, virtual time must be monotonic"
    },
    {
      "code": 6005,
      "name": "notFullyFunded",
      "msg": "Scenario is not fully funded"
    },
    {
      "code": 6006,
      "name": "wrongPath",
      "msg": "Operation does not match the settlement path"
    },
    {
      "code": 6007,
      "name": "amountZero",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6008,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "chainHead",
      "docs": [
        "On-chain anchor of the off-chain provenance hash chain.",
        "",
        "PDA seeds: `[\"chain_head\", scenario]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "scenario",
            "docs": [
              "The scenario this chain belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "finalHash",
            "docs": [
              "Head hash of the provenance chain (64 zeros before the first event)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "eventCount",
            "docs": [
              "Number of events anchored so far."
            ],
            "type": "u64"
          },
          {
            "name": "anchoredUnixTs",
            "docs": [
              "Real unix timestamp when the chain head was last anchored."
            ],
            "type": "i64"
          },
          {
            "name": "anchoredVirtualMs",
            "docs": [
              "Virtual clock time when the chain head was last anchored."
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "leg",
      "docs": [
        "Which leg of the FX trade is being referenced."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "leg1Usd"
          },
          {
            "name": "leg2Cad"
          }
        ]
      }
    },
    {
      "name": "raceStatus",
      "docs": [
        "Lifecycle of a settlement scenario on chain."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "new"
          },
          {
            "name": "ack"
          },
          {
            "name": "paying"
          },
          {
            "name": "settled"
          },
          {
            "name": "defaulted"
          },
          {
            "name": "failed"
          }
        ]
      }
    },
    {
      "name": "scenario",
      "docs": [
        "A single settlement race scenario account.",
        "",
        "PDA seeds: `[\"scenario\", driver, scenario_id_le_u64]`."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "driver",
            "docs": [
              "Driver (engine) wallet that created and controls the scenario."
            ],
            "type": "pubkey"
          },
          {
            "name": "partyA",
            "docs": [
              "Party A wallet (USD payer on the sequential path)."
            ],
            "type": "pubkey"
          },
          {
            "name": "partyB",
            "docs": [
              "Party B wallet (CAD payer on the sequential path)."
            ],
            "type": "pubkey"
          },
          {
            "name": "ticketHash",
            "docs": [
              "SHA-256 of the canonical trade ticket JSON (excluding ticket_hash)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "status",
            "docs": [
              "Current lifecycle status."
            ],
            "type": {
              "defined": {
                "name": "raceStatus"
              }
            }
          },
          {
            "name": "path",
            "docs": [
              "Settlement route for this scenario."
            ],
            "type": {
              "defined": {
                "name": "settlementPath"
              }
            }
          },
          {
            "name": "leg1UsdCents",
            "docs": [
              "Notional of leg 1 in USD cents."
            ],
            "type": "u64"
          },
          {
            "name": "leg2CadCents",
            "docs": [
              "Notional of leg 2 in CAD cents."
            ],
            "type": "u64"
          },
          {
            "name": "fundedUsdCents",
            "docs": [
              "USD cents funded into escrow so far."
            ],
            "type": "u64"
          },
          {
            "name": "fundedCadCents",
            "docs": [
              "CAD cents funded into escrow so far."
            ],
            "type": "u64"
          },
          {
            "name": "paidCadCents",
            "docs": [
              "CAD cents released to party A so far (sequential leg 2 progress)."
            ],
            "type": "u64"
          },
          {
            "name": "ackA",
            "docs": [
              "Whether party A has acknowledged the ticket."
            ],
            "type": "bool"
          },
          {
            "name": "ackB",
            "docs": [
              "Whether party B has acknowledged the ticket."
            ],
            "type": "bool"
          },
          {
            "name": "virtualNowMs",
            "docs": [
              "Virtual clock time in milliseconds."
            ],
            "type": "i64"
          },
          {
            "name": "raceStartedAtMs",
            "docs": [
              "Virtual time the race started, 0 if not started."
            ],
            "type": "i64"
          },
          {
            "name": "leg1ReleasedAtMs",
            "docs": [
              "Virtual time leg 1 released, 0 if not released."
            ],
            "type": "i64"
          },
          {
            "name": "gapMs",
            "docs": [
              "Gap window in milliseconds between leg 1 and leg 2."
            ],
            "type": "i64"
          },
          {
            "name": "scenarioId",
            "docs": [
              "Scenario identifier (matches the PDA seed)."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "PDA bump."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "settlementPath",
      "docs": [
        "Which settlement route the scenario follows."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "sequential"
          },
          {
            "name": "atomic"
          }
        ]
      }
    }
  ]
};
