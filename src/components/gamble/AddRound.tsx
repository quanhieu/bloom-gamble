import React, {
  FC,
  useCallback,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  IGambleRound,
  INullableGambleRound,
  PlayerKey,
  newRound,
  selectEnableSlackNotification,
  selectIsGPT,
  selectPlayer,
  selectSlackThread,
} from "./gambleSlice";
import { partition, sortBy } from "lodash";
import { fullFillRound, parseRoundString } from "../../lib/convert-pattern";
import EnterPoint from "./EnterPoint";
import { speak } from "@/utils/speech";
import EnterLoserPoint from "./EnterLoserPoint";
import IconPlus from "../icons/plus";
import useProfiles from "@/hooks/useUserProfiles";
import useMessenger from "@/hooks/useMessenger";

const validateRound = (round: IGambleRound): boolean => {
  const { A, B, C, D } = round;
  const isAllValued =
    A !== null &&
    A !== undefined &&
    typeof A === "number" &&
    B !== null &&
    B !== undefined &&
    typeof B === "number" &&
    C !== null &&
    C !== undefined &&
    typeof C === "number" &&
    D !== null &&
    D !== undefined &&
    typeof D === "number";

  if (isAllValued) {
    // enter 4 zeros
    if (!A && !B && !C && !D) {
      return false;
    }
    const total = (A ?? 0) + (B ?? 0) + (C ?? 0) + (D ?? 0);
    if (total !== 0) {
      return false;
    }
  } else {
    return false;
  }

  return true;
};

const AddRow: FC = () => {
  const players = useAppSelector(selectPlayer);
  const slackThread = useAppSelector(selectSlackThread);
  const isGPT = useAppSelector(selectIsGPT);
  const isNotificationEnabled = useAppSelector(selectEnableSlackNotification);
  const dispatch = useAppDispatch();
  const [round, setRound] = useState<INullableGambleRound>({
    A: null,
    B: null,
    C: null,
    D: null,
  });
  const [smartFill, setSmartFill] = useState("");
  const profiles = useProfiles();
  const { sendMessage } = useMessenger();
  const [isAdding, startAddingTransition] = useTransition();

  const getPlayerName = useCallback(
    (id: string) => {
      return profiles?.find((player) => player.id === id)?.name ?? "Unknown";
    },
    [profiles],
  );

  const setPoint = useCallback((name: string, value: number | null) => {
    setRound((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const addNewRound = useCallback(
    (round: IGambleRound) => {
      startAddingTransition(async () => {
        const { A, B, C, D } = round;
        const sortedRound = Object.entries(round).sort(
          ([, valueA], [, valueB]) => valueA - valueB,
        );
        const playerMessages = sortedRound.map(([key, point]) =>
          point !== null
            ? `${getPlayerName(players[key as PlayerKey])}: ${
                point >= 0 ? "cộng " : "trừ "
              }${Math.abs(point)}`
            : null,
        );
        const playerMessagesToSlack = sortedRound.map(([key, point]) =>
          point !== null
            ? `${getPlayerName(players[key as PlayerKey])}: ${point}`
            : null,
        );

        if (playerMessages.length > 0) {
          const message = `Kết quả: ${playerMessages.join(", ")}.`;
          console.log(message);
          speak(message);

          const max = Math.max(A, B, C, D);
          const maxKey = Object.keys(round).find(
            (key) => round[key as PlayerKey] === max,
          );
          const names = Object.keys(round).map(
            (key) => players[key as PlayerKey],
          );
          const winnerName = players[maxKey as PlayerKey];

          if (isNotificationEnabled) {
            sendMessage(playerMessagesToSlack.join(", "), slackThread)
              .then((response) => {
                console.info(response);
              })
              .catch((error) => {
                console.error(error);
              });
          }

          if (isGPT && isNotificationEnabled) {
            fetch("/api/ai", {
              method: "POST",
              body: JSON.stringify({
                names,
                winnerName,
              }),
            })
              .then((response) => response.json())
              .then(async (response: { message: string }) => {
                const mes = response.message;
                if (mes) {
                  speak(mes);
                  await sendMessage(mes, slackThread);
                }
              })
              .catch(() => {
                console.error("Could not get from AI");
              });
          }
        }

        dispatch(
          newRound({
            A: A,
            B: B,
            C: C,
            D: D,
          }),
        );
      });
    },
    [
      dispatch,
      players,
      isNotificationEnabled,
      isGPT,
      slackThread,
      getPlayerName,
      sendMessage,
    ],
  );

  const onSubmit = useCallback(() => {
    const { A, B, C, D } = round;
    addNewRound({
      A,
      B,
      C,
      D,
    } as IGambleRound);
    setRound({
      A: null,
      B: null,
      C: null,
      D: null,
    });
  }, [addNewRound, round]);

  const isAbleToAdd = useMemo(() => {
    return validateRound(round as IGambleRound);
  }, [round]);

  const calcLastPlayerPoint = useCallback((prev: IGambleRound) => {
    const keys: PlayerKey[] = ["A", "B", "C", "D"];
    const [entered, empties] = partition(keys, (k: string) => {
      return (
        prev[k as PlayerKey] !== null && prev[k as PlayerKey] !== undefined
      );
    });
    if (empties.length === 1) {
      let autoValue = 0;
      entered.forEach((e: string) => {
        autoValue -= prev[e as PlayerKey] ?? 0;
      });
      const next = { ...prev };

      next[empties[0]] = autoValue;
      return next;
    }

    return prev;
  }, []);

  const onAfterChange = useCallback(
    (playerKey: string, value: number | null) => {
      const keys = ["A", "B", "C", "D"];
      // case white win
      if (value !== null && value !== undefined && !isNaN(value)) {
        if (value === 39) {
          const [, left] = partition(keys, (k) => k === playerKey);
          const next = {
            [playerKey]: 39,
          };
          left.forEach((key) => {
            next[key] = -13;
          });
          addNewRound(next as IGambleRound);
          setRound({
            A: null,
            B: null,
            C: null,
            D: null,
          });
        } else {
          // not white win
          setRound((prev) => {
            const calc = calcLastPlayerPoint({
              A: prev.A ?? null,
              B: prev.B ?? null,
              C: prev.C ?? null,
              D: prev.D ?? null,
            } as IGambleRound);
            if (validateRound(calc)) {
              addNewRound(calc);
              return {
                A: null,
                B: null,
                C: null,
                D: null,
              };
            } else {
              return {
                A: calc.A ?? null,
                B: calc.B ?? null,
                C: calc.C ?? null,
                D: calc.D ?? null,
              };
            }
          });
        }
      }
    },
    [addNewRound, calcLastPlayerPoint],
  );

  const _convertSmartFill = useCallback(() => {
    const parsedRound = fullFillRound(parseRoundString(smartFill, players));
    if (parsedRound) {
      let next = {
        A: parsedRound.A ?? parsedRound.A ?? null,
        B: parsedRound.B ?? parsedRound.B ?? null,
        C: parsedRound.C ?? parsedRound.C ?? null,
        D: parsedRound.D ?? parsedRound.D ?? null,
      };
      next = calcLastPlayerPoint(next);
      const isValid = validateRound(next);
      if (!isValid) {
        setRound({
          A: next.A ? -next.A : null,
          B: next.B ? -next.B : null,
          C: next.C ? -next.C : null,
          D: next.D ? -next.D : null,
        });
      } else {
        addNewRound({
          A: -next.A,
          B: -next.B,
          C: -next.C,
          D: -next.D,
        });
        setRound({
          A: null,
          B: null,
          C: null,
          D: null,
        });
      }
      setSmartFill("");
    }
  }, [smartFill, players, calcLastPlayerPoint, addNewRound]);

  return (
    <>
      <tr data-is-adding={isAdding}>
        <td className="text-xs">Nhập điểm từng thằng</td>
        {sortBy(Object.keys(round)).map((id: string) => (
          <td key={id}>
            <EnterPoint
              key={id}
              playerName={getPlayerName(players[id as PlayerKey])}
              value={round[id as PlayerKey] ?? null}
              onChange={(value: number | null) => {
                setPoint(id, value);
                onAfterChange(id, value);
              }}
            />
          </td>
        ))}
        <td>
          <button
            disabled={!isAbleToAdd}
            title="Add"
            className="rounded-full bg-blue-500 p-2 text-2xl text-white disabled:opacity-30"
            onClick={onSubmit}
          >
            <IconPlus />
          </button>
        </td>
      </tr>
      <tr data-is-adding={isAdding}>
        <td className="text-xs">
          Nhấp thằng thắng
          <br />
          (Tới trắng x 2)
        </td>
        {sortBy(Object.keys(round)).map((id: string) => (
          <td key={id}>
            <EnterLoserPoint
              winnerId={id as PlayerKey}
              key={id}
              onChange={(r: IGambleRound) => {
                addNewRound(r);
              }}
            />
          </td>
        ))}
        <td></td>
      </tr>
    </>
  );
};

export default AddRow;
