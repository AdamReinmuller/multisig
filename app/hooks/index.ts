import {
  AnchorProvider,
  BN,
  Program,
  ProgramAccount,
  web3,
} from "@project-serum/anchor";
import {
  IdlTypes,
  TypeDef,
} from "@project-serum/anchor/dist/cjs/program/namespace/types";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "react-query";
import { ArrElement, Multisig } from "types";
import idl from "types/idl.json";

export type PDA = {
  Idx: BN;
  pubKey: web3.PublicKey;
  bump: number;
};

const programId = new web3.PublicKey(
  "8XHSyugWk2uYagCREiD2fSRkgGcTPYvwipXgd9c7em2i"
);

const a = JSON.stringify(idl);
const multiSigIdl = JSON.parse(a);

const getMultisigPDA = async (): Promise<PDA> => {
  const uid = new BN(parseInt((Date.now() / 1000).toString()));
  // const uidBuffer = uid.toBuffer("le", 8);
  // const uidBuffer = Buffer.from(uid, "base64url");
  const uidBuffer = uid.toArrayLike(Buffer, "le", 8);
  const [multisigWalletPubKey, multisigBump] =
    await web3.PublicKey.findProgramAddress(
      [Buffer.from("multisig"), uidBuffer],
      programId
    );

  return {
    Idx: uid,
    pubKey: multisigWalletPubKey,
    bump: multisigBump,
  };
};

const getTransactionPDA = async (
  multisigWalletPubKey: web3.PublicKey,
  proposalCount: BN
): Promise<PDA> => {
  const proposalCountBuffer = proposalCount.toArrayLike(Buffer, "le", 8);
  const [transactionPubKey, transactionBump] =
    await web3.PublicKey.findProgramAddress(
      [
        Buffer.from("transaction"),
        multisigWalletPubKey.toBuffer(),
        proposalCountBuffer,
      ],
      programId
    );

  return {
    Idx: proposalCount,
    pubKey: transactionPubKey,
    bump: transactionBump,
  };
};

export const useProgram = () => {
  const wallet = useAnchorWallet();
  const { connection } = useConnection();

  if (!wallet) {
    return;
  }

  const provider = new AnchorProvider(connection, wallet, {
    preflightCommitment: "processed",
  });

  const program = new Program(
    multiSigIdl,
    programId,
    provider
  ) as unknown as Program<Multisig>;

  return program;
};

export const useBalance = (keyString: string | undefined) => {
  const { connection } = useConnection();

  const { data } = useQuery(
    ["multisigWallets"],
    async () => {
      const data = await connection.getBalance(new web3.PublicKey(keyString!));
      return data;
    },
    {
      enabled: !!keyString,
    }
  );

  return data;
};

export const useMultisigWallet = (pubKeyString: string | undefined) => {
  const program = useProgram();

  return useQuery(
    ["multisigWallet"],
    async () => {
      const data = await program!.account.multisigWalletState.fetch(
        new web3.PublicKey(pubKeyString!)
      );
      return data;
    },
    {
      enabled: !!program || !!pubKeyString,
    }
  );
};

export const useMultisigWallets = () => {
  const program = useProgram();

  return useQuery(
    ["multisigWallets"],
    async () => {
      const data = await program!.account.multisigWalletState.all();
      return data;
    },
    {
      enabled: !!program,
    }
  );
};

type MultisigWalletListType = ReturnType<typeof useMultisigWallets>["data"];
export type MultisigWalletType = ArrElement<MultisigWalletListType>;

export const useTransactions = () => {
  const program = useProgram();

  return useQuery(
    ["transactions"],
    async () => {
      const data = await program?.account.transactionState.all();
      return data;
    },
    {
      enabled: !!program,
    }
  );
};

type TransactionListType = ReturnType<typeof useTransactions>["data"];
export type TransactionType = ArrElement<TransactionListType>;

export const useInitializeMultisigWallet = (
  ownerA?: string,
  ownerB?: string,
  ownerC?: string,
  threshold?: string
) => {
  const [receipt, setReceipt] = useState<web3.TransactionResponse | null>();
  const program = useProgram();

  const onInitMultisigWallet = useCallback(async () => {
    if (!program || !ownerA || !ownerB || !ownerC || !threshold) {
      return;
    }

    const multisigPDA = await getMultisigPDA();

    const ownerAPubKey = new web3.PublicKey(ownerA);
    const ownerBPubKey = new web3.PublicKey(ownerB);
    const ownerCPubKey = new web3.PublicKey(ownerC);
    const thresholdBn = new BN(threshold);

    const tx = await program.methods
      .initializeNewMultisigWallet(
        multisigPDA.Idx,
        [ownerAPubKey, ownerBPubKey, ownerCPubKey],
        thresholdBn
      )
      .accounts({
        multisigWalletAccount: multisigPDA.pubKey,
        payer: program.provider.publicKey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const receipt = await program.provider.connection.getTransaction(tx, {
      commitment: "confirmed",
    });
    setReceipt(receipt);
  }, [ownerA, ownerB, ownerC, program, threshold]);

  return {
    onInitMultisigWallet,
    receipt,
  };
};

export const useProposeTransaction = (
  to?: string,
  amount?: string,
  multisigWalletKeyString?: string,
  proposalCount?: string
) => {
  const [receipt, setReceipt] = useState<web3.TransactionResponse | null>();
  const program = useProgram();

  const onProposeTransaction = useCallback(async () => {
    if (
      !program ||
      !to ||
      !amount ||
      !multisigWalletKeyString ||
      !proposalCount
    ) {
      return;
    }

    const multisigWalletPubKey = new web3.PublicKey(multisigWalletKeyString);
    const proposalCountBn = new BN(proposalCount);

    const transactionPDA = await getTransactionPDA(
      multisigWalletPubKey,
      proposalCountBn
    );

    const recipientPubKey = new web3.PublicKey(to);
    const amountInSol = new BN(parseFloat(amount) * LAMPORTS_PER_SOL);

    const tx = await program.methods
      .proposeTransaction(recipientPubKey, amountInSol)
      .accounts({
        multisigWalletAccount: multisigWalletPubKey,
        transactionAccount: transactionPDA.pubKey,
        proposer: program.provider.publicKey,
        systemProgram: web3.SystemProgram.programId,
        rent: web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const receipt = await program.provider.connection.getTransaction(tx, {
      commitment: "confirmed",
    });
    setReceipt(receipt);
  }, [amount, multisigWalletKeyString, program, proposalCount, to]);

  return {
    onProposeTransaction,
    receipt,
  };
};

export const useApproveTransaction = (
  multisigWalletKeyString: string | undefined,
  proposalKeyString: string | undefined
) => {
  const [receipt, setReceipt] = useState<web3.TransactionResponse | null>();
  const program = useProgram();

  const onApproveTransaction = useCallback(async () => {
    if (!program || !multisigWalletKeyString || !proposalKeyString) {
      return;
    }

    const multisigWalletPubKey = new web3.PublicKey(multisigWalletKeyString);
    const transactionPubKey = new web3.PublicKey(proposalKeyString);

    const tx = await program.methods
      .approveTransaction()
      .accounts({
        multisigWalletAccount: multisigWalletPubKey,
        transactionAccount: transactionPubKey,
        approver: program.provider.publicKey,
      })
      .rpc();

    const receipt = await program.provider.connection.getTransaction(tx, {
      commitment: "confirmed",
    });
    setReceipt(receipt);
  }, [multisigWalletKeyString, program, proposalKeyString]);

  return {
    onApproveTransaction,
    receipt,
  };
};

export const useExecuteTransaction = (
  multisigWalletKeyString: string | undefined,
  proposalKeyString: string | undefined,
  recipientKeyString: string | undefined
) => {
  const [receipt, setReceipt] = useState<web3.TransactionResponse | null>();
  const program = useProgram();

  const onExecuteTransaction = useCallback(async () => {
    if (
      !program ||
      !multisigWalletKeyString ||
      !proposalKeyString ||
      !recipientKeyString
    ) {
      return;
    }

    const multisigWalletPubKey = new web3.PublicKey(multisigWalletKeyString);
    const transactionPubKey = new web3.PublicKey(proposalKeyString);
    const recipientPubKey = new web3.PublicKey(recipientKeyString);

    const tx = await program.methods
      .executeTransaction()
      .accounts({
        multisigWalletAccount: multisigWalletPubKey,
        recipient: recipientPubKey,
        systemProgram: web3.SystemProgram.programId,
        transactionAccount: transactionPubKey,
      })
      .rpc();

    const receipt = await program.provider.connection.getTransaction(tx, {
      commitment: "confirmed",
    });
    setReceipt(receipt);
  }, [multisigWalletKeyString, program, proposalKeyString, recipientKeyString]);

  return {
    onExecuteTransaction,
    receipt,
  };
};
