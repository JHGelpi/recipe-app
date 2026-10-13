import { Text, View } from 'react-native';
import { StatusLine } from '../src/components/StatusLine';

export default function Home() {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text role="heading" aria-level={1} style={{ fontSize: 24, fontWeight: '600' }}>
        Recipes
      </Text>
      <StatusLine />
    </View>
  );
}
