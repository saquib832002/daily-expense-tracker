import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  confirmAllInbox,
  confirmInboxItem,
  listCategories,
  listInbox,
  rejectInboxItem,
} from '@/db/queries';
import type { Category, Transaction } from '@/db/schema';
import { relativeDayKey } from '@/domain/dates';
import { formatMinor } from '@/domain/money';
import { formatDate, t } from '@/i18n';
import { radius, space, type, useTheme } from '@/theme';
import { Button, EmptyState, Screen } from '@/ui';

/**
 * The inbox: things the app recorded for you, waiting for one tap.
 *
 * Today it holds recurring transactions that are not set to auto-post. When
 * receipt scanning and SMS capture arrive, they land here too — nothing the
 * app captures automatically is ever written silently into the ledger. That
 * rule is the whole basis for trusting an app that types for you.
 */
export default function InboxScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [items, setItems] = useState<Transaction[]>([]);
  const [categoryById, setCategoryById] = useState<Record<string, Category>>({});

  const load = useCallback(async () => {
    const map: Record<string, Category> = {};
    for (const c of [...(await listCategories('expense')), ...(await listCategories('income'))]) {
      map[c.id] = c;
    }
    setCategoryById(map);
    setItems(await listInbox());
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const confirm = useCallback(
    async (id: string) => {
      await confirmInboxItem(id);
      await load();
    },
    [load],
  );

  const reject = useCallback(
    async (id: string) => {
      await rejectInboxItem(id);
      await load();
    },
    [load],
  );

  const confirmAll = useCallback(async () => {
    await confirmAllInbox();
    await load();
  }, [load]);

  return (
    <Screen title={t('inbox.title')} back>
      {items.length === 0 ? (
        <EmptyState text={t('inbox.empty')} />
      ) : (
        <>
          <Text style={[styles.lead, { color: theme.textDim }]}>
            {t('inbox.lead', { count: items.length })}
          </Text>

          {items.map((item) => {
            const cat = item.categoryId ? categoryById[item.categoryId] : null;
            const dayKey = relativeDayKey(item.occurredAt);
            return (
              <View
                key={item.id}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Pressable style={styles.head} onPress={() => router.push(`/txn/${item.id}`)}>
                  <Text style={styles.icon}>{cat?.icon ?? '•'}</Text>
                  <View style={styles.headMain}>
                    <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>
                      {item.merchant ||
                        (cat ? (cat.customName ?? t(cat.nameKey ?? '')) : t('add.expense'))}
                    </Text>
                    <Text style={[styles.meta, { color: theme.textDim }]}>
                      {dayKey ? t(dayKey) : formatDate(item.occurredAt)}
                      {'  ·  '}
                      {t(`inbox.source.${item.source}`)}
                    </Text>
                  </View>
                  <Text style={[styles.amount, { color: theme.text }]}>
                    {formatMinor(item.amountMinor, item.currency, { compact: true, signed: true })}
                  </Text>
                </Pressable>

                <View style={styles.actions}>
                  <View style={styles.action}>
                    <Button label={t('inbox.confirm')} onPress={() => confirm(item.id)} />
                  </View>
                  <View style={styles.action}>
                    <Button
                      label={t('inbox.reject')}
                      variant="secondary"
                      onPress={() => reject(item.id)}
                    />
                  </View>
                </View>
              </View>
            );
          })}

          {items.length > 1 ? (
            <Button label={t('inbox.confirmAll')} variant="secondary" onPress={confirmAll} />
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { fontSize: type.small },
  card: { borderWidth: 1, borderRadius: radius.md, padding: space.md, gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  icon: { fontSize: 20 },
  headMain: { flex: 1, gap: 2 },
  title: { fontSize: type.body },
  meta: { fontSize: type.tiny },
  amount: { fontSize: type.body, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: space.sm },
  action: { flex: 1 },
});
